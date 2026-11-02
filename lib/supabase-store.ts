import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { setCatalog, type CatalogRow } from "@/lib/catalog";
import { ConfigError } from "@/lib/security";
import { dedupeStoredTransactions, emptyState, type Store } from "@/lib/store";
import type { AppState, Charge, Connection, ServiceLogo, StoredTx, Subscription, SubscriptionStatus } from "@/lib/types";

const logoMemory = new Map<string, ServiceLogo>();

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
      const [connections, subscriptions, charges, ignored, services] = await Promise.all([
        client.from("connections").select("*"),
        client.from("subscriptions").select("*"),
        client.from("charges").select("*"),
        client.from("ignored_descriptors").select("descriptor"),
        client.from("catalog_services").select("*").eq("active", true),
      ]);
      // The catalog only names things. If the table is missing or unreadable,
      // keep the last catalog this process loaded and carry on.
      if (!services.error && services.data) setCatalog(services.data.map(mapCatalogRow));
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
      const unique = dedupeStoredTransactions(rows);
      await upsert(
        client,
        "transactions",
        unique.map((row) => ({
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
      logoMemory.clear();
    },
    async getServiceLogo(merchantKey) {
      const cached = logoMemory.get(merchantKey);
      try {
        const client = admin();
        const { data, error } = await client.from("service_logos").select("*").eq("merchant_key", merchantKey).maybeSingle();
        if (error || !data) return cached ?? null;
        const record = mapLogo(data as Record<string, unknown>);
        logoMemory.set(merchantKey, record);
        return record;
      } catch {
        return cached ?? null;
      }
    },
    async saveServiceLogo(record) {
      logoMemory.set(record.merchantKey, record);
      try {
        const client = admin();
        const { error } = await client.from("service_logos").upsert({
          merchant_key: record.merchantKey,
          domain: record.domain,
          logo_url: record.logoUrl,
          source_url: record.sourceUrl,
          source: record.source,
          resolved_at: record.resolvedAt,
          status: record.status,
        });
        if (error) return;
      } catch {
        /* table may not exist until the migration is applied */
      }
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
    type: row.tx_type ? String(row.tx_type) : null,
    category: row.category ? String(row.category) : null,
    operationType: row.operation_type ? String(row.operation_type) : null,
  };
}

function mapLogo(row: Record<string, unknown>): ServiceLogo {
  const source = String(row.source ?? "fallback");
  const allowed = new Set(["catalog", "site", "google", "duckduckgo", "fallback"]);
  return {
    merchantKey: String(row.merchant_key),
    domain: row.domain ? String(row.domain) : null,
    logoUrl: row.logo_url ? String(row.logo_url) : null,
    sourceUrl: row.source_url ? String(row.source_url) : null,
    source: (allowed.has(source) ? source : "fallback") as ServiceLogo["source"],
    resolvedAt: row.resolved_at ? String(row.resolved_at) : new Date(0).toISOString(),
    status: row.status === "ok" ? "ok" : "fallback",
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

function mapCatalogRow(row: Record<string, unknown>): CatalogRow {
  return {
    id: String(row.id),
    serviceName: String(row.service_name ?? row.id),
    company: String(row.company ?? ""),
    manageUrl: typeof row.manage_url === "string" ? row.manage_url : "",
    cancelUrl: typeof row.cancel_url === "string" ? row.cancel_url : "",
    plans: Array.isArray(row.plans) ? (row.plans as CatalogRow["plans"]) : [],
    patterns: Array.isArray(row.patterns) ? (row.patterns as string[][]) : [],
    logo: typeof row.logo === "string" ? row.logo : "",
    domains: Array.isArray(row.domains) ? (row.domains as string[]) : [],
    foreign: row.is_foreign === true,
  };
}
