import { attachKnownCharges, dropShadowedSuggestions, mergeDetections, pruneSuggestions } from "@/lib/actions";
import { CURRENT_IMPORT_VERSION, todayInSaoPaulo, transactionQueries, windowStart } from "@/lib/dates";
import { ensureLogos } from "@/lib/logos/resolve";
import { detect, knownMerchants } from "@/lib/matching";
import { accountSummary, itemIdsForRun, mapPluggyTransaction, replaceSiblings, upsertConnectionFromItem } from "@/lib/pluggy/map";
import type { PluggySource } from "@/lib/pluggy/client";
import { safeLog } from "@/lib/security";
import { dedupeStoredTransactions, storeLogoCache } from "@/lib/store";
import type { Store } from "@/lib/store";
import type { Connection, StoredTx } from "@/lib/types";

/** A sync step failed. `step` is a short code, never a message from another system. */
export class SyncStepError extends Error {
  readonly step: string;

  constructor(step: string) {
    super(step);
    this.name = "SyncStepError";
    this.step = step;
  }
}

function logSyncFailure(step: string, status = "error"): void {
  console.info(JSON.stringify(safeLog({ count: 0, status, errorCode: step })));
}

function asStep(error: unknown, step: string): SyncStepError {
  if (error instanceof SyncStepError) return error;
  logSyncFailure(step);
  return new SyncStepError(step);
}

async function runStep<T>(step: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw asStep(error, step);
  }
}

export type SyncDeps = {
  store: Store;
  pluggy: PluggySource | null;
  now: () => Date;
  seedItemId?: string;
};

function assertSingleDateParam(query: { dateFrom?: string; createdAtFrom?: string }): void {
  if (query.dateFrom && query.createdAtFrom) {
    throw new Error("dateFrom e createdAtFrom não podem ir juntos");
  }
}

async function pullTransactions(pluggy: PluggySource, connection: Connection, now: Date): Promise<StoredTx[]> {
  const accounts = await pluggy.getAccounts(connection.itemId);
  connection.accounts = accounts.map(accountSummary);
  const today = todayInSaoPaulo(now);
  const rows: StoredTx[] = [];
  for (const account of accounts) {
    const queries = transactionQueries({
      accountId: account.id,
      lastSyncedAt: connection.lastSyncedAt,
      today,
      importVersion: connection.importVersion,
    });
    for (const query of queries) {
      assertSingleDateParam(query);
      const transactions = await pluggy.listTransactions(query);
      for (const transaction of transactions) {
        const stored = mapPluggyTransaction(transaction, connection.itemId, account.id);
        if (stored) rows.push(stored);
      }
    }
  }
  return dedupeStoredTransactions(rows);
}

export async function syncItem(deps: SyncDeps, itemId: string, event: string, deletedIds: string[] = []): Promise<void> {
  if (!deps.pluggy) {
    logSyncFailure("pluggy_unconfigured");
    throw new SyncStepError("pluggy_unconfigured");
  }
  const pluggy = deps.pluggy;
  const state = await runStep("load_failed", () => deps.store.load());
  if (event === "item/deleted") {
    const gone = state.connections.find((row) => row.itemId === itemId);
    if (gone && gone.status !== "removed") {
      gone.status = "removed";
      await runStep("save_failed", () => deps.store.save(state));
    }
    return;
  }
  const item = await runStep("item_failed", () => pluggy.getItem(itemId));
  const now = deps.now();
  let connections = upsertConnectionFromItem(state.connections, item, now);
  if (event === "item/created") connections = replaceSiblings(connections, item);
  state.connections = connections;
  const connection = state.connections.find((row) => row.itemId === itemId);
  if (!connection) return;
  if (connection.status !== "active") {
    await runStep("save_failed", () => deps.store.save(state));
    console.info(JSON.stringify(safeLog({ count: 0, status: connection.status, errorCode: connection.lastErrorCode })));
    return;
  }

  let fetched: StoredTx[] = [];
  try {
    fetched = await pullTransactions(pluggy, connection, now);
  } catch (error) {
    if (error instanceof SyncStepError) throw error;
    try {
      await deps.store.save(state);
    } catch (saveError) {
      throw asStep(saveError, "save_failed");
    }
    logSyncFailure("fetch_failed", connection.status);
    throw new SyncStepError("fetch_failed");
  }

  await runStep("upsert_failed", () => deps.store.upsertTransactions(fetched));
  if (event === "transactions/deleted" && deletedIds.length > 0) {
    const fresh = new Set(fetched.map((row) => row.id));
    await runStep("delete_failed", () => deps.store.deleteTransactions(deletedIds.filter((id) => !fresh.has(id))));
  }

  const today = todayInSaoPaulo(now);
  const history = await runStep("history_failed", () => deps.store.transactionsSince(windowStart(today, connection.lastSyncedAt === null)));
  const byId = new Map(history.map((row) => [row.id, row]));
  for (const row of fetched) byId.set(row.id, { ...byId.get(row.id), ...row });
  const rows = [...byId.values()];
  let detections;
  try {
    detections = detect(
      rows.map((row) => ({
        id: row.id,
        description: row.description,
        amount: row.amount,
        chargeDate: row.chargeDate,
        foreignCharge: row.foreignCharge,
        type: row.type,
        category: row.category,
        operationType: row.operationType,
        status: row.status,
        paymentMethod: row.paymentMethod,
        merchantName: row.merchantName,
        counterpartyName: row.counterpartyName,
        counterpartyKind: row.counterpartyKind,
      })),
      state.ignoredDescriptors,
      today,
      knownMerchants(state.subscriptions),
    );
  } catch (error) {
    throw asStep(error, "detect_failed");
  }
  if (event === "item/created") state.connections = replaceSiblings(state.connections, item);
  const dates = fetched.map((row) => row.chargeDate).sort();
  connection.lastSyncedAt = now.toISOString();
  connection.importVersion = CURRENT_IMPORT_VERSION;
  connection.lastSyncHadData = fetched.length > 0;
  if (dates.at(-1)) connection.lastDataThrough = dates.at(-1) ?? null;
  let next;
  try {
    next = dropShadowedSuggestions(pruneSuggestions(mergeDetections(attachKnownCharges(state, rows), detections, true), detections));
  } catch (error) {
    throw asStep(error, "detect_failed");
  }
  try {
    await ensureLogos(next, now, storeLogoCache(deps.store));
  } catch {
    logSyncFailure("logo_failed");
  }
  await runStep("save_failed", () => deps.store.save(next));
  await runStep("purge_failed", () =>
    deps.store.purgeUnlinked(
      windowStart(today, false),
      next.charges.map((charge) => charge.transactionId),
    ),
  );
  console.info(JSON.stringify(safeLog({ count: fetched.length, status: connection.status, errorCode: connection.lastErrorCode })));
}

export async function syncAll(deps: SyncDeps): Promise<{ ok: boolean; message?: string; code?: string }> {
  if (!deps.pluggy) {
    logSyncFailure("pluggy_unconfigured");
    return { ok: false, message: "Configuração incompleta: PLUGGY_CLIENT_ID", code: "pluggy_unconfigured" };
  }
  let state;
  try {
    state = await deps.store.load();
  } catch (error) {
    const step = asStep(error, "load_failed");
    return { ok: false, message: "Falha ao ler a Pluggy.", code: step.step };
  }
  const ids = itemIdsForRun(state.connections, deps.seedItemId);
  let failed = false;
  let code: string | undefined;
  for (const itemId of ids) {
    try {
      await syncItem(deps, itemId, "item/updated");
    } catch (error) {
      failed = true;
      const step = error instanceof SyncStepError ? error : asStep(error, "sync_failed");
      code ??= step.step;
    }
  }
  return failed ? { ok: false, message: "Falha ao ler a Pluggy.", code: code ?? "sync_failed" } : { ok: true };
}
