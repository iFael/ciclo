import { descriptorWords, hasPhrase, normalizeDescriptor } from "@/lib/text";

/**
 * Descriptors that never name a specific service. Recurrence does not matter.
 * Matched on the normalized, accent-stripped text.
 */
const GENERIC_PHRASES: string[][] = [
  ["ASSINATURA", "VIA", "APPLE"],
  ["APPLE", "COM", "BILL"],
  ["APPLECOMBILL"],
  ["GOOGLE", "PLAY"],
  ["GOOGLEPLAY"],
  ["GOOGLE", "PLAY", "STORE"],
  ["PLAY", "STORE"],
  ["APP", "STORE"],
  ["ITUNES"],
  ["ITUNES", "COM"],
  ["ITUNES", "COM", "BILL"],
  ["PAYPAL"],
  ["PAGSEGURO"],
  ["MERCADOPAGO"],
  ["MERCADO", "PAGO"],
  ["STRIPE"],
  ["PICPAY"],
  ["GOOGLE", "PAYMENT"],
];

export type TxSignals = {
  description: string;
  amount: number;
  type?: string | null;
  category?: string | null;
  operationType?: string | null;
};

/**
 * Why a transaction cannot be a subscription, or null when it might be one.
 * Kinds: credit, juros, multa, iof, pix, transfer, installment, refund, fee, boleto, generic.
 */
export function excludedKind(tx: TxSignals): string | null {
  const type = (tx.type ?? "").toUpperCase();
  if (type === "CREDIT" || tx.amount <= 0) return "credit";
  const words = descriptorWords(tx.description);
  const operation = normalizeDescriptor(tx.operationType ?? "");
  const category = normalizeDescriptor(tx.category ?? "");
  const operationWords = operation ? operation.split(" ") : [];

  if (words.includes("ESTORNO") || words.includes("REEMBOLSO") || words.includes("DEVOLUCAO") || words.includes("REFUND")) {
    return "refund";
  }
  if (words.includes("IOF") || operationWords.includes("IOF")) return "iof";
  if (words.includes("JUROS") || category.includes("JUROS") || category.includes("INTEREST")) return "juros";
  if (words.includes("MULTA")) return "multa";
  if (words.includes("PIX") || operationWords.includes("PIX") || operation === "PIX") return "pix";
  if (
    words.includes("TED") ||
    words.includes("DOC") ||
    words.includes("TRANSFERENCIA") ||
    operationWords.includes("TED") ||
    operationWords.includes("DOC") ||
    category.includes("TRANSFER")
  ) {
    return "transfer";
  }
  if (words.includes("PARCELA") || words.includes("PARC")) return "installment";
  if (words.includes("TARIFA") || words.includes("ANUIDADE") || words.includes("ENCARGO") || category.includes("FEE") || category.includes("TAX")) {
    return "fee";
  }
  if (words.includes("BOLETO") || hasPhrase(words, ["PAGAMENTO", "DE", "TITULO"]) || hasPhrase(words, ["CONTA", "DE", "LUZ"]) || hasPhrase(words, ["CONTA", "DE", "AGUA"])) {
    return "boleto";
  }
  if (words.includes("RECEBIDO")) return "credit";
  return null;
}

export function isGenericDescriptor(description: string): boolean {
  const words = descriptorWords(description);
  if (words.length === 0) return false;
  return GENERIC_PHRASES.some((phrase) => {
    if (words.length === phrase.length && phrase.every((word, index) => words[index] === word)) return true;
    return hasPhrase(words, phrase) && words.length <= phrase.length + 1;
  });
}

export function isIofRotativo(description: string): boolean {
  const words = descriptorWords(description);
  return words.includes("IOF") && words.includes("ROTATIVO");
}
