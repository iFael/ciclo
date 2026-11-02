export function normalizeDescriptor(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function descriptorWords(input: string): string[] {
  const normalized = normalizeDescriptor(input);
  return normalized ? normalized.split(" ") : [];
}

export function hasWord(words: string[], word: string): boolean {
  return words.includes(word);
}

export function hasPhrase(words: string[], phrase: string[]): boolean {
  if (phrase.length === 1) return words.includes(phrase[0]);
  for (let index = 0; index <= words.length - phrase.length; index += 1) {
    if (phrase.every((word, offset) => words[index + offset] === word)) return true;
  }
  return false;
}

export function matchesPattern(words: string[], phrase: string[]): boolean {
  if (hasPhrase(words, phrase)) return true;
  return phrase.length > 1 && phrase.every((word) => words.includes(word));
}

/**
 * Payment intermediaries that prefix the real merchant on a card statement,
 * e.g. "MERCADOPAGO*IFOOD", "PAYPAL *NETFLIX", "EBANX*SPOTIFY".
 */
const INTERMEDIARY_WORDS = new Set([
  "MERCADOPAGO",
  "MP",
  "IFD",
  "ZP",
  "ASA",
  "PAYPAL",
  "PAGSEGURO",
  "PAGSEG",
  "PAGS",
  "PG",
  "EBANX",
  "EBN",
  "DLOCAL",
  "DL",
  "PICPAY",
  "STRIPE",
  "IUGU",
  "PAGARME",
  "ADYEN",
  "CIELO",
  "STONE",
  "GETNET",
  "SUMUP",
  "PAG",
  "PAGAMENTO",
  "COMPRA",
]);
const INTERMEDIARY_PHRASES: string[][] = [
  ["MERCADO", "PAGO"],
  ["PAG", "SEGURO"],
  ["COMPRA", "NO", "DEBITO"],
  ["COMPRA", "DEBITO"],
  ["COMPRA", "CARTAO"],
];

/** The merchant words after any leading intermediary prefix. Empty when only the intermediary is left. */
export function merchantWords(input: string): string[] {
  const words = descriptorWords(input);
  let index = 0;
  let moved = true;
  while (moved && index < words.length) {
    moved = false;
    for (const phrase of INTERMEDIARY_PHRASES) {
      if (phrase.every((word, offset) => words[index + offset] === word)) {
        index += phrase.length;
        moved = true;
        break;
      }
    }
    if (!moved && INTERMEDIARY_WORDS.has(words[index])) {
      index += 1;
      moved = true;
    }
  }
  return words.slice(index);
}

export function merchantDescriptor(input: string): string {
  const rest = merchantWords(input);
  return rest.length > 0 ? rest.join(" ") : normalizeDescriptor(input);
}
