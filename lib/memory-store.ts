import type { Store } from "@/lib/store";
import { emptyState } from "@/lib/store";
import type { AppState, ServiceLogo, StoredTx } from "@/lib/types";

export function createMemoryStore(initial?: Partial<AppState> & { transactions?: StoredTx[]; reminders?: string[] }): Store {
  let state: AppState = {
    ...emptyState(),
    ...structuredClone(initial ?? {}),
    connections: structuredClone(initial?.connections ?? []),
    subscriptions: structuredClone(initial?.subscriptions ?? []),
    charges: structuredClone(initial?.charges ?? []),
    ignoredDescriptors: [...(initial?.ignoredDescriptors ?? [])],
  };
  const transactions = new Map<string, StoredTx>();
  for (const row of initial?.transactions ?? []) transactions.set(row.id, { ...row });
  const reminders = new Map<string, string>();
  for (const key of initial?.reminders ?? []) reminders.set(key, "test");
  const logos = new Map<string, ServiceLogo>();

  return {
    async load() {
      return structuredClone(state);
    },
    async save(next) {
      state = structuredClone(next);
    },
    async upsertTransactions(rows) {
      for (const row of rows) transactions.set(row.id, { ...row });
    },
    async deleteTransactions(ids) {
      for (const id of ids) transactions.delete(id);
    },
    async transactionsSince(date) {
      return [...transactions.values()].filter((row) => row.chargeDate >= date).map((row) => ({ ...row }));
    },
    async purgeUnlinked(olderThan, keepIds) {
      const keep = new Set(keepIds);
      for (const [id, row] of transactions) {
        if (row.chargeDate < olderThan && !keep.has(id)) transactions.delete(id);
      }
    },
    async sentReminderKeys() {
      return [...reminders.keys()];
    },
    async markReminder(key, kind) {
      if (reminders.has(key)) return false;
      reminders.set(key, kind);
      return true;
    },
    async wipe() {
      state = emptyState();
      transactions.clear();
      reminders.clear();
      logos.clear();
    },
    async getServiceLogo(merchantKey) {
      return logos.get(merchantKey) ?? null;
    },
    async saveServiceLogo(record) {
      logos.set(record.merchantKey, { ...record });
    },
  };
}
