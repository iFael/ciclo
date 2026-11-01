import { isForeignService, planNameFor } from "@/lib/catalog";
import { addMonthsClamp, diffDays, saoPauloCivilDate } from "@/lib/dates";
import { formatBrl, round2 } from "@/lib/format";

export const BRL_TOLERANCE = 0.02;
export const FOREIGN_TOLERANCE = 0.1;

export type ServiceId = "chatgpt" | "claude" | "grok" | "apple";

export type CandidateTx = {
  id: string;
  description: string;
  amount: number;
  chargeDate: string;
  mcc?: number;
  foreignCharge?: boolean;
};

export type Detection = {
  merchantKey: string;
  service: string;
  planName: string;
  amount: number;
  approximate: boolean;
  checked: boolean;
  autoConfirmed: boolean;
  confirm: boolean;
  planChangeNotice: string | null;
  descriptors: string[];
  suggestionLabel: string | null;
  charges: { transactionId: string; chargeDate: string; amount: number }[];
  expectedChargeDate: string;
};

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

function hasWord(words: string[], word: string): boolean {
  return words.includes(word);
}

function hasPhrase(words: string[], phrase: string[]): boolean {
  for (let index = 0; index <= words.length - phrase.length; index += 1) {
    if (phrase.every((word, offset) => words[index + offset] === word)) return true;
  }
  return false;
}

export function isIofRotativo(description: string): boolean {
  const words = descriptorWords(description);
  return hasWord(words, "IOF") && hasWord(words, "ROTATIVO");
}

export function classifyDescriptor(description: string): ServiceId | null {
  if (isIofRotativo(description)) return null;
  const words = descriptorWords(description);
  if (hasWord(words, "OPENAI") && hasWord(words, "CHATGPT")) return "chatgpt";
  if (hasWord(words, "ANTHROPIC") && hasWord(words, "CLAUDE")) return "claude";
  if (hasWord(words, "GROK") && hasWord(words, "XAI")) return "grok";
  if (hasPhrase(words, ["APPLE", "COM", "BILL"]) || hasWord(words, "APPLECOMBILL")) return "apple";
  return null;
}

export function withinTolerance(base: number, next: number, foreign: boolean): boolean {
  if (base === 0) return false;
  const pct = Math.abs(next - base) / Math.abs(base);
  return pct <= (foreign ? FOREIGN_TOLERANCE : BRL_TOLERANCE) + 1e-9;
}

export function chargeDateOf(tx: {
  date: string;
  creditCardMetadata?: { transactionDateTime?: string } | null;
}): string {
  const stamped = tx.creditCardMetadata?.transactionDateTime;
  if (stamped) return saoPauloCivilDate(stamped);
  return tx.date.slice(0, 10);
}

function latestMonthlyChain(sorted: CandidateTx[]): CandidateTx[] {
  if (sorted.length === 0) return [];
  const chain = [sorted[sorted.length - 1]];
  for (let index = sorted.length - 2; index >= 0; index -= 1) {
    const gap = diffDays(sorted[index].chargeDate, chain[0].chargeDate);
    if (gap >= 28 && gap <= 35) chain.unshift(sorted[index]);
    else break;
  }
  return chain;
}

function noticeFor(chain: CandidateTx[], foreign: boolean): string | null {
  let anchor = chain[0]?.amount ?? 0;
  let notice: string | null = null;
  for (const charge of chain.slice(1)) {
    if (!withinTolerance(anchor, charge.amount, foreign)) {
      notice = `O valor passou de ${formatBrl(anchor)} para ${formatBrl(charge.amount)}.`;
      anchor = charge.amount;
    }
  }
  return notice;
}

function toCharges(chain: CandidateTx[]): Detection["charges"] {
  return chain.map((charge) => ({
    transactionId: charge.id,
    chargeDate: charge.chargeDate,
    amount: round2(charge.amount),
  }));
}

function detectionFrom(input: {
  merchantKey: string;
  service: string;
  chain: CandidateTx[];
  descriptors: string[];
  foreign: boolean;
  mode: "known" | "apple" | "unknown";
}): Detection | null {
  const chain = latestMonthlyChain([...input.chain].sort((a, b) => a.chargeDate.localeCompare(b.chargeDate)));
  if (input.mode === "unknown" && chain.length < 2) return null;
  if (chain.length === 0) return null;
  const amount = round2(chain[chain.length - 1].amount);
  const expectedChargeDate = addMonthsClamp(chain[chain.length - 1].chargeDate, 1);
  const planChangeNotice = input.mode === "apple" ? null : noticeFor(chain, input.foreign);
  if (input.mode === "apple") {
    return {
      merchantKey: input.merchantKey,
      service: "apple",
      planName: "Assinatura via Apple",
      amount,
      approximate: true,
      checked: chain.length >= 2,
      autoConfirmed: false,
      confirm: false,
      planChangeNotice: null,
      descriptors: input.descriptors,
      suggestionLabel: chain.length < 2 ? "Pode ser recorrente" : null,
      charges: toCharges(chain),
      expectedChargeDate,
    };
  }
  if (input.mode === "unknown") {
    return {
      merchantKey: input.merchantKey,
      service: "unknown",
      planName: titleCase(input.descriptors[0] ?? "Assinatura"),
      amount,
      approximate: false,
      checked: chain.length >= 3,
      autoConfirmed: false,
      confirm: false,
      planChangeNotice,
      descriptors: input.descriptors,
      suggestionLabel: null,
      charges: toCharges(chain),
      expectedChargeDate,
    };
  }
  const confirmed = chain.length >= 2;
  return {
    merchantKey: input.merchantKey,
    service: input.service,
    planName: planNameFor(input.service, amount),
    amount,
    approximate: true,
    checked: false,
    autoConfirmed: confirmed,
    confirm: confirmed,
    planChangeNotice,
    descriptors: input.descriptors,
    suggestionLabel: confirmed ? null : "Pode ser recorrente",
    charges: toCharges(chain),
    expectedChargeDate,
  };
}

function titleCase(normalized: string): string {
  return normalized
    .toLowerCase()
    .split(" ")
    .filter((word) => !["subscr", "subscription", "bill"].includes(word))
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function clusterByAmount(txs: CandidateTx[], foreign: boolean): CandidateTx[][] {
  const sorted = [...txs].sort((a, b) => a.amount - b.amount || a.chargeDate.localeCompare(b.chargeDate));
  const clusters: { anchor: number; txs: CandidateTx[] }[] = [];
  for (const tx of sorted) {
    const found = clusters.find((cluster) => withinTolerance(cluster.anchor, tx.amount, foreign));
    if (found) found.txs.push(tx);
    else clusters.push({ anchor: tx.amount, txs: [tx] });
  }
  return clusters.map((cluster) => cluster.txs);
}

export function detect(transactions: CandidateTx[], ignored: string[]): Detection[] {
  const ignoredSet = new Set(ignored.map((item) => normalizeDescriptor(item)));
  const usable = transactions.filter((tx) => {
    if (tx.amount <= 0) return false;
    if (isIofRotativo(tx.description)) return false;
    const normalized = normalizeDescriptor(tx.description);
    if (ignoredSet.has(normalized)) return false;
    return true;
  });

  const groups = new Map<string, CandidateTx[]>();
  const unknown = new Map<string, CandidateTx[]>();
  for (const tx of usable) {
    const service = classifyDescriptor(tx.description);
    if (!service) {
      const key = normalizeDescriptor(tx.description);
      unknown.set(key, [...(unknown.get(key) ?? []), tx]);
      continue;
    }
    groups.set(service, [...(groups.get(service) ?? []), tx]);
  }

  const found: Detection[] = [];
  for (const [service, txs] of groups) {
    if (service === "apple") {
      for (const cluster of clusterByAmount(txs, true)) {
        const anchor = [...cluster].sort((a, b) => a.amount - b.amount)[0];
        const detection = detectionFrom({
          merchantKey: `apple:${Math.round(anchor.amount * 100)}`,
          service,
          chain: cluster,
          descriptors: uniqueDescriptors(cluster),
          foreign: true,
          mode: "apple",
        });
        if (detection) found.push(detection);
      }
      continue;
    }
    const detection = detectionFrom({
      merchantKey: service,
      service,
      chain: txs,
      descriptors: uniqueDescriptors(txs),
      foreign: isForeignService(service),
      mode: "known",
    });
    if (detection) found.push(detection);
  }

  for (const [descriptor, txs] of unknown) {
    const foreign = txs.some((tx) => tx.foreignCharge);
    const clusters = foreign ? clusterByAmount(txs, true) : [txs];
    clusters.forEach((cluster, index) => {
      const detection = detectionFrom({
        merchantKey: clusters.length > 1 ? `unknown:${descriptor}:${index}` : `unknown:${descriptor}`,
        service: "unknown",
        chain: cluster,
        descriptors: [descriptor],
        foreign,
        mode: "unknown",
      });
      if (detection) {
        detection.approximate = foreign;
        found.push(detection);
      }
    });
  }
  return found;
}

function uniqueDescriptors(txs: CandidateTx[]): string[] {
  return [...new Set(txs.map((tx) => normalizeDescriptor(tx.description)))];
}
