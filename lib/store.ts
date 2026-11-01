import type { AppState, StoredTx } from "@/lib/types";

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
}

export function emptyState(): AppState {
  return { connections: [], subscriptions: [], charges: [], ignoredDescriptors: [] };
}
