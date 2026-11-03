import { isForeignService } from "@/lib/catalog";
import { chargeDateOf, classifyDescriptor } from "@/lib/matching";
import type { Connection, ConnectionAccount, ConnectionStatus } from "@/lib/types";
import type { PluggyAccount, PluggyItem, PluggyTransaction } from "@/lib/pluggy/types";
import type { StoredTx } from "@/lib/types";

export function mapItemStatus(item: PluggyItem, now: Date): { status: ConnectionStatus; errorCode: string | null } {
  const code = item.error?.code ?? null;
  if (code === "USER_AUTHORIZATION_EXPIRED") return { status: "expired", errorCode: code };
  if (item.status === "LOGIN_ERROR" || code === "LOGIN_ERROR") return { status: "error", errorCode: "LOGIN_ERROR" };
  if (item.consentExpiresAt && new Date(item.consentExpiresAt).getTime() <= now.getTime()) {
    return { status: "expired", errorCode: "CONSENT_EXPIRED" };
  }
  return { status: "active", errorCode: null };
}

export function upsertConnectionFromItem(connections: Connection[], item: PluggyItem, now: Date): Connection[] {
  const mapped = mapItemStatus(item, now);
  const current = connections.find((connection) => connection.itemId === item.id);
  const row: Connection = {
    id: current?.id ?? crypto.randomUUID(),
    itemId: item.id,
    institution: item.connector?.name ?? current?.institution ?? null,
    connectorId: item.connector?.id ?? current?.connectorId ?? null,
    status: mapped.status,
    consentExpiresAt: item.consentExpiresAt ?? null,
    lastSyncedAt: current?.lastSyncedAt ?? null,
    lastErrorCode: mapped.errorCode,
    lastSyncHadData: current?.lastSyncHadData ?? false,
    lastDataThrough: current?.lastDataThrough ?? null,
    importVersion: current?.importVersion ?? 1,
    accounts: current?.accounts ?? [],
  };
  return [...connections.filter((connection) => connection.itemId !== item.id), row];
}

/** MeuPluggy is one connector for many banks: one item per bank, all with the same connector. */
export function isAggregator(institution: string | null | undefined): boolean {
  return (institution ?? "").toLowerCase().replace(/\s+/g, "") === "meupluggy";
}

function retired(connection: Connection): boolean {
  return connection.status === "replaced" || connection.status === "removed";
}

/** Same card or account seen on two items: same kind, same last digits, same name. */
function accountKey(account: ConnectionAccount): string | null {
  if (!account.last4) return null;
  return `${account.kind}:${account.last4}:${(account.name ?? "").toLowerCase()}`;
}

function shareAccounts(a: Connection, b: Connection): boolean {
  const keys = new Set((a.accounts ?? []).map(accountKey).filter((key): key is string => key !== null));
  return (b.accounts ?? []).some((account) => {
    const key = accountKey(account);
    return key !== null && keys.has(key);
  });
}

/**
 * A new item for a bank replaces the old item of that bank. For a bank's own
 * connector the connector says it. Through MeuPluggy every bank has the same
 * connector, so the old item is replaced only when it holds the same cards.
 */
export function replaceSiblings(connections: Connection[], item: PluggyItem): Connection[] {
  const connectorId = item.connector?.id;
  if (!connectorId) return connections;
  const fresh = connections.find((connection) => connection.itemId === item.id);
  const aggregator = isAggregator(item.connector?.name);
  if (aggregator && !(fresh?.accounts ?? []).length) return connections;
  return connections.map((connection) => {
    if (connection.itemId === item.id) return connection;
    if (connection.connectorId !== connectorId || retired(connection)) return connection;
    if (aggregator && (!fresh || !shareAccounts(fresh, connection))) return connection;
    return { ...connection, status: "replaced" };
  });
}

export function itemIdsForRun(connections: Connection[], seed?: string): string[] {
  if (connections.length === 0) return seed ? [seed] : [];
  return connections.filter((connection) => !retired(connection)).map((connection) => connection.itemId);
}

const BRANDS: Record<string, string> = {
  MASTERCARD: "Mastercard",
  VISA: "Visa",
  ELO: "Elo",
  AMEX: "Amex",
  AMERICAN_EXPRESS: "Amex",
  HIPERCARD: "Hipercard",
  DINERS: "Diners",
};

/** Keeps the name and the last four digits. The full number and the balance stay at Pluggy. */
export function accountSummary(account: PluggyAccount): ConnectionAccount {
  const card = account.type === "CREDIT" || account.subtype === "CREDIT_CARD";
  const digits = (account.number ?? "").replace(/\D/g, "");
  const rawBrand = account.creditData?.brand?.trim().toUpperCase() ?? "";
  const name = (account.marketingName ?? account.name ?? "").trim();
  return {
    id: account.id,
    kind: card ? "card" : "account",
    name: name || null,
    brand: rawBrand ? (BRANDS[rawBrand] ?? rawBrand.charAt(0) + rawBrand.slice(1).toLowerCase()) : null,
    last4: card && digits.length >= 4 ? digits.slice(-4) : null,
  };
}

/**
 * The amount as a positive charge in reais.
 * - Bank accounts send debits as negative numbers (a card-debit purchase,
 *   an automatic debit). A DEBIT is a charge whatever its sign.
 * - Foreign charges use the converted amount when Pluggy sends it.
 */
export function chargeAmount(tx: PluggyTransaction): number {
  const foreign = Boolean(tx.currencyCode && tx.currencyCode !== "BRL");
  const base = foreign && typeof tx.amountInAccountCurrency === "number" && tx.amountInAccountCurrency !== 0 ? tx.amountInAccountCurrency : tx.amount;
  if ((tx.type ?? "").toUpperCase() === "DEBIT") return Math.abs(base);
  return base;
}

/** Keep all bank movements; classification happens later, never at ingestion. */
export function mapPluggyTransaction(tx: PluggyTransaction, itemId: string, accountId: string): StoredTx | null {
  const description = tx.description ?? "";
  const amount = chargeAmount(tx);
  const service = classifyDescriptor(description);
  const foreignCharge = Boolean(service && isForeignService(service)) || Boolean(tx.currencyCode && tx.currencyCode !== "BRL");
  const receiver = tx.paymentData?.receiver;
  return {
    id: tx.id,
    itemId,
    accountId: tx.accountId || accountId,
    amount,
    originalAmount: tx.amount,
    description,
    descriptionRaw: tx.descriptionRaw ?? null,
    chargeDate: chargeDateOf(tx),
    foreignCharge,
    type: tx.type ?? null,
    status: tx.status ?? null,
    category: tx.category ?? null,
    operationType: tx.operationType ?? null,
    merchantName: tx.merchant?.name ?? tx.merchant?.businessName ?? null,
    counterpartyName: receiver?.name ?? null,
    counterpartyKind: receiver?.documentNumber?.type === "CNPJ" ? "business" : receiver?.documentNumber?.type === "CPF" ? "person" : null,
    paymentMethod: tx.paymentData?.paymentMethod ?? null,
  };
}
