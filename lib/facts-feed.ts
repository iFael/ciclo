import type { StoredTx } from "@/lib/types";

export type FactsFeedTransaction = {
  id: string;
  itemId: string;
  accountId: string;
  amount: number;
  originalAmount: number | null;
  chargeDate: string;
  type: string | null;
  status: string | null;
  operationType: string | null;
  description: string;
  descriptionRaw: string | null;
  counterpartyName: string | null;
  counterpartyKind: "person" | "business" | null;
  paymentMethod: string | null;
};

export function normalizeBankText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function factsFeedTransactions(rows: StoredTx[], targetName: string): FactsFeedTransaction[] {
  const target = normalizeBankText(targetName);
  if (!target) return [];

  return rows
    .filter((row) => row.type?.toUpperCase() === "DEBIT")
    .filter((row) => !row.status || row.status.toUpperCase() === "POSTED")
    .filter((row) => {
      const fields = [row.counterpartyName, row.descriptionRaw, row.description]
        .filter((value): value is string => Boolean(value))
        .map(normalizeBankText);
      return fields.some((value) => value.includes(target));
    })
    .map((row) => ({
      id: row.id,
      itemId: row.itemId,
      accountId: row.accountId,
      amount: row.amount,
      originalAmount: row.originalAmount ?? null,
      chargeDate: row.chargeDate,
      type: row.type ?? null,
      status: row.status ?? null,
      operationType: row.operationType ?? null,
      description: row.description,
      descriptionRaw: row.descriptionRaw ?? null,
      counterpartyName: row.counterpartyName ?? null,
      counterpartyKind: row.counterpartyKind ?? null,
      paymentMethod: row.paymentMethod ?? null,
    }));
}
