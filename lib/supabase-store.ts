import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ConfigError } from "@/lib/security";
import { emptyState, type Store } from "@/lib/store";
import type { AppState, Charge, Connection, StoredTx, Subscription, SubscriptionStatus } from "@/lib/types";

function admin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new ConfigError("NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new ConfigError("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function num(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

async function fail(error: { message: string } | null): Promise<void> {
  if (error) throw new Error("db_failed");
}

export function createSupabaseStore(): Store {
  return {
    async load() {
      const client = admin();
      const [connections, subscriptions, charges, ignored] = await Promise.all([
        client.from("connections").select("*"),
        client.from("subscriptions").select("*"),
        client.from("charges").select("*"),
        client.from("ignored_descriptors").select("descriptor"),
      ]);
      await fail(connections.error);
      await fail(subscriptions.error);
      await fail(charges.error);
      await fail(ignored.error);
      const state = emptyState();
      state.connections = (connections.data ?? []).map(mapConnection);
      state.subscriptions = (subscriptions.data ?? []).map(mapSubscription);
      state.charges = (charges.data ?? []).map(mapCharge);
      state.ignoredDescriptors = (ignored.data ?? []).map((row) => String(row.descriptor));
      return state;
    },
    async save(state) {
      const client = admin();
      await upsert(client, "connections", state.connections.map(connectionRow));
      await upsert(client, "subscriptions", state.subscriptions.map(subscriptionRow));
      await upsert(client, "charges", state.charges.map(chargeRow), "subscription_id,charge_date");
      await upsert(
        client,
        "ignored_descriptors",
        state.ignoredDescriptors.map((descriptor) => ({ descriptor })),
        "descriptor",
      );
      await deleteMissing(client, "connections", "id", state.connections.map((row) => row.id));
      await deleteMissing(client, "subscriptions", "id", state.subscriptions.map((row) => row.id));
      await deleteMissing(
        client,
        "charges",
        "transaction_id",
        state.charges.map((row) => row.transactionId),
      );
      await deleteMissing(client, "ignored_descriptors", "descriptor", state.ignoredDescriptors);
    },
    async upsertTransactions(rows) {
      const client = admin();
      await upsert(
        client,
        "transactions",
        rows.map((row) => ({
          id: row.id,
          item_id: row.itemId,
          account_id: row.accountId,
          amount: row.amount,
          description: row.description,
          charge_date: row.chargeDate,
          foreign_charge: row.foreignCharge,
        })),
      );
    },
    async deleteTransactions(ids) {
      if (ids.length === 0) return;
      const client = admin();
      const { error } = await client.from("transactions").delete().in("id", ids);
      await fail(error);
    },
    async transactionsSince(date) {
      const client = admin();
      const { data, error } = await client.from("transactions").select("*").gte("charge_date", date);
      await fail(error);
      return (data ?? []).map(mapTx);
    },
    async purgeUnlinked(olderThan, keepIds) {
      const client = admin();
      const { data, error } = await client.from("transactions").select("id,charge_date").lt("charge_date", olderThan);
      await fail(error);
      const keep = new Set(keepIds);
      const ids = (data ?? []).map((row) => String(row.id)).filter((id) => !keep.has(id));
      if (ids.length === 0) return;
      const deleted = await client.from("transactions").delete().in("id", ids);
      await fail(deleted.error);
    },
    async sentReminderKeys() {
      const client = admin();
      const { data, error } = await client.from("reminders_sent").select("reminder_key");
      await fail(error);
      return (data ?? []).map((row) => String(row.reminder_key));
    },
    async markReminder(key, kind) {
      const client = admin();
      const { error } = await client.from("reminders_sent").insert({ reminder_key: key, kind });
      if (error?.code === "23505") return false;
      await fail(error);
      return true;
    },
    async wipe() {
      const client = admin();
      await deleteAll(client, "charges", "subscription_id");
      await deleteAll(client, "subscriptions", "id");
      await deleteAll(client, "transactions", "id");
      await deleteAll(client, "reminders_sent", "reminder_key");
      await deleteAll(client, "ignored_descriptors", "descriptor");
      await deleteAll(client, "connections", "id");
    },
  };
}

async function upsert(client: SupabaseClient, table: string, rows: Record<string, unknown>[], onConflict = "id"): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await client.from(table).upsert(rows, { onConflict });
  await fail(error);
}

async function deleteAll(client: SupabaseClient, table: string, column: string): Promise<void> {
  const { error } = await client.from(table).delete().not(column, "is", null);
  await fail(error);
}

async function deleteMissing(client: SupabaseClient, table: string, column: string, keep: string[]): Promise<void> {
  const { data, error } = await client.from(table).select(column);
  await fail(error);
  const keepSet = new Set(keep);
  const extra = ((data ?? []) as unknown as Record<string, unknown>[])
    .map((row) => String(row[column] ?? ""))
    .filter((id) => id && !keepSet.has(id));
  if (extra.length === 0) return;
  const deleted = await client.from(table).delete().in(column, extra);
  await fail(deleted.error);
}

function mapConnection(row: Record<string, unknown>): Connection {
  return {
    id: String(row.id),
    itemId: String(row.item_id),
    institution: row.institution ? String(row.institution) : null,
    connectorId: row.connector_id ? String(row.connector_id) : null,
    status: row.status as Connection["status"],
    consentExpiresAt: row.consent_expires_at ? String(row.consent_expires_at) : null,
    lastSyncedAt: row.last_synced_at ? String(row.last_synced_at) : null,
    lastErrorCode: row.last_error_code ? String(row.last_error_code) : null,
    lastSyncHadData: Boolean(row.last_sync_had_data),
    lastDataThrough: row.last_data_through ? String(row.last_data_through) : null,
  };
}

function mapSubscription(row: Record<string, unknown>): Subscription {
  return {
    id: String(row.id),
    service: String(row.service),
    planName: String(row.plan_name),
    status: row.status as SubscriptionStatus,
    dismissedAt: row.dismissed_at ? String(row.dismissed_at) : null,
    approximate: Boolean(row.approximate),
    merchantKey: String(row.merchant_key),
    amount: num(row.amount),
    expectedChargeDate: row.expected_charge_date ? String(row.expected_charge_date) : null,
    checked: Boolean(row.checked),
    autoConfirmed: Boolean(row.auto_confirmed),
    planChangeNotice: row.plan_change_notice ? String(row.plan_change_notice) : null,
    undoStatus: (row.undo_status as SubscriptionStatus | null) ?? null,
    suppressAutoConfirm: Boolean(row.suppress_auto_confirm),
    cancelPromptSnoozeDate: row.cancel_prompt_snooze_date ? String(row.cancel_prompt_snooze_date) : null,
    descriptors: Array.isArray(row.descriptors) ? row.descriptors.map(String) : [],
    suggestionLabel: row.suggestion_label ? String(row.suggestion_label) : null,
  };
}

function mapCharge(row: Record<string, unknown>): Charge {
  return {
    subscriptionId: String(row.subscription_id),
    chargeDate: String(row.charge_date),
    amount: num(row.amount),
    transactionId: String(row.transaction_id),
    resolved: Boolean(row.resolved),
  };
}

function mapTx(row: Record<string, unknown>): StoredTx {
  return {
    id: String(row.id),
    itemId: String(row.item_id),
    accountId: String(row.account_id),
    amount: num(row.amount),
    description: String(row.description),
    chargeDate: String(row.charge_date),
    foreignCharge: Boolean(row.foreign_charge),
  };
}

function connectionRow(row: Connection): Record<string, unknown> {
  return {
    id: row.id,
    item_id: row.itemId,
    institution: row.institution,
    connector_id: row.connectorId,
    status: row.status,
    consent_expires_at: row.consentExpiresAt,
    last_synced_at: row.lastSyncedAt,
    last_error_code: row.lastErrorCode,
    last_sync_had_data: row.lastSyncHadData,
    last_data_through: row.lastDataThrough,
    updated_at: new Date().toISOString(),
  };
}

function subscriptionRow(row: Subscription): Record<string, unknown> {
  return {
    id: row.id,
    service: row.service,
    plan_name: row.planName,
    status: row.status,
    dismissed_at: row.dismissedAt,
    approximate: row.approximate,
    merchant_key: row.merchantKey,
    amount: row.amount,
    expected_charge_date: row.expectedChargeDate,
    checked: row.checked,
    auto_confirmed: row.autoConfirmed,
    plan_change_notice: row.planChangeNotice,
    undo_status: row.undoStatus,
    suppress_auto_confirm: row.suppressAutoConfirm,
    cancel_prompt_snooze_date: row.cancelPromptSnoozeDate,
    descriptors: row.descriptors,
    suggestion_label: row.suggestionLabel,
    updated_at: new Date().toISOString(),
  };
}

function chargeRow(row: Charge): Record<string, unknown> {
  return {
    subscription_id: row.subscriptionId,
    charge_date: row.chargeDate,
    amount: row.amount,
    transaction_id: row.transactionId,
    resolved: row.resolved,
  };
}
