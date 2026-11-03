import { excludedKind } from "@/lib/noise";
import { merchantDescriptor, normalizeDescriptor } from "@/lib/text";
import type { StoredTx } from "@/lib/types";

type Movement = Pick<StoredTx, "description" | "amount" | "type" | "status" | "category" | "operationType" | "paymentMethod" | "merchantName" | "counterpartyName" | "counterpartyKind">;

/** A transaction can be retained without being a subscription candidate. */
export function isOutgoing(tx: Movement): boolean {
  return tx.amount > 0 && tx.type !== "CREDIT" && tx.status !== "PENDING";
}

export function isPix(tx: Movement): boolean {
  const method = normalizeDescriptor(tx.paymentMethod ?? tx.operationType ?? "");
  return method === "PIX" || normalizeDescriptor(tx.description).split(" ").includes("PIX");
}

/** A stable payee key across QR Pix, automatic Pix and ordinary merchant labels. */
export function paymentKey(tx: Movement): string {
  const name = tx.counterpartyName || tx.merchantName;
  if (name) return normalizePayee(name);
  const normalized = normalizeDescriptor(tx.description)
    .replace(/^(?:PAGAMENTO COM QR PIX|PAGAMENTO VIA PIX|PAGAMENTO PIX|PIX AUTOMATICO|PAGAMENTO COM PIX|PIX ENVIADO|PIX)\s+/, "");
  return normalizePayee(isPix(tx) ? normalized : merchantDescriptor(tx.description));
}

function normalizePayee(value: string): string {
  return normalizeDescriptor(value).replace(/\s+(?:LTDA|LIMITADA|ME|EIRELI|S A|SA)$/, "").trim();
}

/** Only proven business/automatic outgoing payments enter automatic suggestion scoring.
 * Personal transfers remain searchable, but cannot generate subscriptions by themselves.
 */
export function isSubscriptionCandidate(tx: Movement): boolean {
  if (!isOutgoing(tx)) return false;
  const excluded = excludedKind(tx);
  if (!excluded) return true;
  if (excluded !== "pix" && excluded !== "transfer") return false;
  if (!isPix(tx)) return false;
  if (tx.counterpartyKind === "person") return false;
  return tx.counterpartyKind === "business" || Boolean(tx.merchantName) ||
    /\bPIX AUTOMATICO\b|\bPAGAMENTO COM QR PIX\b/.test(normalizeDescriptor(tx.description));
}

/** A user can manually link an outflow even when it is not eligible for automatic suggestion. */
export function canLinkPayment(tx: Movement): boolean {
  if (!isOutgoing(tx)) return false;
  const excluded = excludedKind(tx);
  return !excluded || excluded === "pix" || excluded === "transfer";
}
