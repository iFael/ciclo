import { isForeignService } from "@/lib/catalog";
import { chargeDateOf, classifyDescriptor } from "@/lib/matching";
import { excludedKind } from "@/lib/noise";
import type { Connection, ConnectionStatus } from "@/lib/types";
import type { PluggyItem, PluggyTransaction } from "@/lib/pluggy/types";
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
  };
  return [...connections.filter((connection) => connection.itemId !== item.id), row];
}

export function replaceSiblings(connections: Connection[], item: PluggyItem): Connection[] {
  const connectorId = item.connector?.id;
  if (!connectorId) return connections;
  return connections.map((connection) => {
    if (connection.itemId === item.id) return connection;
    if (connection.connectorId === connectorId && connection.status !== "replaced") {
      return { ...connection, status: "replaced" };
    }
    return connection;
  });
}

export function itemIdsForRun(connections: Connection[], seed?: string): string[] {
  if (connections.length === 0) return seed ? [seed] : [];
  return connections.filter((connection) => connection.status !== "replaced").map((connection) => connection.itemId);
}

export function mapPluggyTransaction(tx: PluggyTransaction, itemId: string, accountId: string): StoredTx | null {
  const description = tx.description ?? "";
  if (
    excludedKind({
      description,
      amount: tx.amount,
      type: tx.type,
      category: tx.category,
      operationType: tx.operationType,
    })
  ) {
    return null;
  }
  const service = classifyDescriptor(description);
  const foreignCharge = Boolean(service && isForeignService(service)) || Boolean(tx.currencyCode && tx.currencyCode !== "BRL");
  return {
    id: tx.id,
    itemId,
    accountId: tx.accountId || accountId,
    amount: tx.amount,
    description,
    chargeDate: chargeDateOf(tx),
    foreignCharge,
    type: tx.type ?? null,
    category: tx.category ?? null,
    operationType: tx.operationType ?? null,
  };
}
