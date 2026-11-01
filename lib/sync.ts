import { mergeDetections } from "@/lib/actions";
import { addDays, todayInSaoPaulo, transactionQueries, windowStart } from "@/lib/dates";
import { detect } from "@/lib/matching";
import { itemIdsForRun, mapPluggyTransaction, replaceSiblings, upsertConnectionFromItem } from "@/lib/pluggy/map";
import type { PluggySource } from "@/lib/pluggy/client";
import { safeLog } from "@/lib/security";
import type { Store } from "@/lib/store";
import type { Connection, StoredTx } from "@/lib/types";

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
  const today = todayInSaoPaulo(now);
  const rows: StoredTx[] = [];
  for (const account of accounts) {
    const queries = transactionQueries({
      accountId: account.id,
      lastSyncedAt: connection.lastSyncedAt,
      today,
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
  return rows;
}

export async function syncItem(deps: SyncDeps, itemId: string, event: string, deletedIds: string[] = []): Promise<void> {
  if (!deps.pluggy) throw new Error("Configuração incompleta: PLUGGY_CLIENT_ID");
  const state = await deps.store.load();
  const item = await deps.pluggy.getItem(itemId);
  const now = deps.now();
  let connections = upsertConnectionFromItem(state.connections, item, now);
  if (event === "item/created") connections = replaceSiblings(connections, item);
  state.connections = connections;
  const connection = state.connections.find((row) => row.itemId === itemId);
  if (!connection) return;
  if (connection.status !== "active") {
    await deps.store.save(state);
    console.info(JSON.stringify(safeLog({ count: 0, status: connection.status, errorCode: connection.lastErrorCode })));
    return;
  }

  let fetched: StoredTx[] = [];
  try {
    fetched = await pullTransactions(deps.pluggy, connection, now);
  } catch {
    await deps.store.save(state);
    console.info(JSON.stringify(safeLog({ count: 0, status: connection.status, errorCode: "fetch_failed" })));
    throw new Error("pluggy_fetch_failed");
  }

  await deps.store.upsertTransactions(fetched);
  if (event === "transactions/deleted" && deletedIds.length > 0) {
    const fresh = new Set(fetched.map((row) => row.id));
    await deps.store.deleteTransactions(deletedIds.filter((id) => !fresh.has(id)));
  }

  const today = todayInSaoPaulo(now);
  const history = await deps.store.transactionsSince(windowStart(today, connection.lastSyncedAt === null));
  const detections = detect(
    history.map((row) => ({
      id: row.id,
      description: row.description,
      amount: row.amount,
      chargeDate: row.chargeDate,
      foreignCharge: row.foreignCharge,
    })),
    state.ignoredDescriptors,
  );
  const dates = fetched.map((row) => row.chargeDate).sort();
  connection.lastSyncedAt = now.toISOString();
  connection.lastSyncHadData = fetched.length > 0;
  if (dates.at(-1)) connection.lastDataThrough = dates.at(-1) ?? null;
  const next = mergeDetections(state, detections, true);
  await deps.store.save(next);
  await deps.store.purgeUnlinked(
    addDays(today, -90),
    next.charges.map((charge) => charge.transactionId),
  );
  console.info(JSON.stringify(safeLog({ count: fetched.length, status: connection.status, errorCode: connection.lastErrorCode })));
}

export async function syncAll(deps: SyncDeps): Promise<{ ok: boolean; message?: string }> {
  if (!deps.pluggy) return { ok: false, message: "Configuração incompleta: PLUGGY_CLIENT_ID" };
  const state = await deps.store.load();
  const ids = itemIdsForRun(state.connections, deps.seedItemId);
  let failed = false;
  for (const itemId of ids) {
    try {
      await syncItem(deps, itemId, "item/updated");
    } catch {
      failed = true;
    }
  }
  return failed ? { ok: false, message: "Falha ao ler a Pluggy." } : { ok: true };
}
