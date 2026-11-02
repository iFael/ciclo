import type { AppState, ServiceLogo, StoredTx } from "@/lib/types";

/** Last row wins. Postgres rejects one upsert that names the same id twice. */
export function dedupeStoredTransactions(rows: StoredTx[]): StoredTx[] {
  const byId = new Map<string, StoredTx>();
  for (const row of rows) byId.set(row.id, row);
  return [...byId.values()];
}

export interface Store {
  load(): Promise<AppState>;
  save(state: AppState): Promise<void>;
  upsertTransactions(rows: StoredTx[]): Promise<void>;
  deleteTransactions(ids: string[]): Promise<void>;
  transactionsSince(date: string): Promise<StoredTx[]>;
  purgeUnlinked(olderThan: string, keepIds: string[]): Promise<void>;
  sentReminderKeys(): Promise<string[]>;
  markReminder(key: string, kind: string): Promise<boolean>;
  wipe(): Promise<void>;
  getServiceLogo(merchantKey: string): Promise<ServiceLogo | null>;
  saveServiceLogo(record: ServiceLogo): Promise<void>;
}

export function storeLogoCache(store: Store): {
  get(merchantKey: string): Promise<ServiceLogo | null>;
  put(record: ServiceLogo): Promise<void>;
} {
  return {
    get: (merchantKey) => store.getServiceLogo(merchantKey),
    put: (record) => store.saveServiceLogo(record),
  };
}

export function emptyState(): AppState {
  return { connections: [], subscriptions: [], charges: [], ignoredDescriptors: [] };
}
