import { descriptorWords } from "@/lib/text";

const DROP = new Set([
  "PAG",
  "MP",
  "DL",
  "PIX",
  "SUBSCR",
  "SUBSCRIPTION",
  "BILL",
  "COMPRA",
  "DEBITO",
  "CREDITO",
  "BRASIL",
  "SAO",
  "PAULO",
  "RIO",
  "JANEIRO",
  "CURITIBA",
  "BELO",
  "HORIZONTE",
  "RECIFE",
  "FORTALEZA",
  "BRASILIA",
  "PORTO",
  "ALEGRE",
  "CAMPINAS",
  "INTERNET",
  "WWW",
  "COM",
  "BR",
]);

export function cleanMerchantName(description: string): string {
  return descriptorWords(description)
    .filter((word) => !DROP.has(word) && !/^\d+$/.test(word))
    .join(" ");
}

export function normalizeDomain(input: string): string | null {
  const value = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .replace(/^www\./, "")
    .replace(/\.$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value) || value.length > 253) return null;
  return value;
}

/** Domains hinted by the descriptor, then name.com and name.com.br. */
export function inferDomains(description: string): string[] {
  const found: string[] = [];
  const host = /\b((?:[a-z0-9-]+\.)+(?:com\.br|com|app|ai|io|sh|tv|net|br))\b/gi;
  for (const match of description.matchAll(host)) {
    const domain = match[1].toLowerCase().replace(/^www\./, "");
    if (!found.includes(domain)) found.push(domain);
  }
  if (found.length > 0) return found;
  const name = cleanMerchantName(description)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  if (name.length >= 3) return [`${name}.com`, `${name}.com.br`];
  return found;
}
