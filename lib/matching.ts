import { buildConfidence, type Confidence, type ConfidenceCheck } from "@/lib/confidence";
import { catalog, isForeignService, planNameFor, serviceInfo } from "@/lib/catalog";
import { diffDays, saoPauloCivilDate, todayInSaoPaulo } from "@/lib/dates";
import { formatBrl, formatDayMonth, round2 } from "@/lib/format";
import { excludedKind, isGenericDescriptor, isIofRotativo, type TxSignals } from "@/lib/noise";
import {
  AMOUNT_TOLERANCE,
  ANNUAL_GAP_MAX,
  ANNUAL_GAP_MIN,
  ANNUAL_GRACE_DAYS,
  DAY_WINDOW,
  MIN_ANNUAL_OCCURRENCES,
  MIN_MONTHLY_OCCURRENCES,
  MONTHLY_GRACE_DAYS,
} from "@/lib/rules";
import { descriptorWords, hasPhrase, matchesPattern, merchantDescriptor, merchantWords, normalizeDescriptor } from "@/lib/text";

export { isIofRotativo, excludedKind, isGenericDescriptor } from "@/lib/noise";
export { normalizeDescriptor, descriptorWords } from "@/lib/text";

export const BRL_TOLERANCE = 0.02;
export const FOREIGN_TOLERANCE = 0.1;

export type CandidateTx = TxSignals & {
  id: string;
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
  /** Last real charge. Not a projected next date. */
  expectedChargeDate: string;
  cadence: "monthly" | "annual";
  confidenceScore: number;
  confidenceLabel: Confidence["label"];
  checks: ConfidenceCheck[];
};

export function withinTolerance(base: number, next: number, foreign: boolean): boolean {
  return withinPercent(base, next, foreign ? FOREIGN_TOLERANCE : BRL_TOLERANCE);
}

export function withinPercent(base: number, next: number, percent: number): boolean {
  if (base === 0) return false;
  return Math.abs(next - base) / Math.abs(base) <= percent + 1e-9;
}

export function chargeDateOf(tx: {
  date: string;
  creditCardMetadata?: { transactionDateTime?: string } | null;
}): string {
  const stamped = tx.creditCardMetadata?.transactionDateTime;
  if (stamped) return saoPauloCivilDate(stamped);
  return tx.date.slice(0, 10);
}

export function merchantIgnoreToken(merchantKey: string): string {
  return `merchant:${merchantKey}`;
}

export function classifyDescriptor(description: string): string | null {
  const words = descriptorWords(description);
  if (words.includes("OPENAI") && words.includes("API")) return null;
  const merchant = merchantWords(description);
  if (hasPhrase(words, ["X", "AI"])) return "grok";
  for (const service of catalog()) {
    if (service.patterns.some((phrase) => matchesPattern(words, phrase) || (merchant.length > 0 && matchesPattern(merchant, phrase)))) {
      return service.id;
    }
  }
  return null;
}

export function parseIgnored(ignored: string[]): { merchants: Set<string>; descriptors: Set<string> } {
  const merchants = new Set<string>();
  const descriptors = new Set<string>();
  for (const item of ignored) {
    if (item.startsWith("merchant:")) merchants.add(item.slice("merchant:".length));
    else descriptors.add(normalizeDescriptor(item));
  }
  return { merchants, descriptors };
}

type MonthStreak = { months: string[]; gapUsed: boolean };

function monthIndex(month: string): number {
  const [year, monthNumber] = month.split("-").map(Number);
  return year * 12 + (monthNumber - 1);
}

/** Streak ending at the latest month. At most one missed month inside it. */
export function monthlyStreak(dates: string[]): MonthStreak | null {
  const months = [...new Set(dates.map((date) => date.slice(0, 7)))].sort();
  if (months.length < MIN_MONTHLY_OCCURRENCES) return null;
  const included = [months[months.length - 1]];
  let gapUsed = false;
  let previous = months[months.length - 1];
  for (let index = months.length - 2; index >= 0; index -= 1) {
    const delta = monthIndex(previous) - monthIndex(months[index]);
    if (delta === 1) {
      included.push(months[index]);
      previous = months[index];
    } else if (delta === 2 && !gapUsed) {
      gapUsed = true;
      included.push(months[index]);
      previous = months[index];
    } else if (delta === 0) {
      continue;
    } else {
      break;
    }
  }
  if (included.length < MIN_MONTHLY_OCCURRENCES) return null;
  return { months: included.sort(), gapUsed };
}

export function annualDates(dates: string[]): string[] | null {
  const sorted = [...dates].sort();
  if (sorted.length < MIN_ANNUAL_OCCURRENCES) return null;
  const picked = [sorted[sorted.length - 1]];
  let cursor = sorted[sorted.length - 1];
  for (let index = sorted.length - 2; index >= 0; index -= 1) {
    const gap = diffDays(sorted[index], cursor);
    if (gap >= ANNUAL_GAP_MIN && gap <= ANNUAL_GAP_MAX) {
      picked.push(sorted[index]);
      cursor = sorted[index];
    }
  }
  if (picked.length < MIN_ANNUAL_OCCURRENCES) return null;
  return picked.sort();
}

function dayOf(iso: string): number {
  return Number(iso.slice(8, 10));
}

function dayDistance(left: number, right: number): number {
  const diff = Math.abs(left - right);
  return Math.min(diff, 30 - diff);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function onePerMonth(txs: CandidateTx[], months: string[]): CandidateTx[] {
  const wanted = new Set(months);
  const byMonth = new Map<string, CandidateTx>();
  for (const tx of [...txs].sort((a, b) => a.chargeDate.localeCompare(b.chargeDate))) {
    const month = tx.chargeDate.slice(0, 7);
    if (!wanted.has(month)) continue;
    byMonth.set(month, tx);
  }
  return [...byMonth.values()].sort((a, b) => a.chargeDate.localeCompare(b.chargeDate));
}

function stableAmounts(amounts: number[]): boolean {
  if (amounts.length === 0) return false;
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  if (min <= 0) return false;
  return (max - min) / min <= AMOUNT_TOLERANCE + 1e-9;
}

function clusterStable(txs: CandidateTx[]): CandidateTx[][] {
  const sorted = [...txs].sort((a, b) => a.amount - b.amount || a.chargeDate.localeCompare(b.chargeDate));
  const clusters: CandidateTx[][] = [];
  for (const tx of sorted) {
    const found = clusters.find((group) => stableAmounts(group.map((item) => item.amount).concat(tx.amount)));
    if (found) found.push(tx);
    else clusters.push([tx]);
  }
  return clusters;
}

function recentEnough(last: string, today: string, cadence: "monthly" | "annual"): boolean {
  const age = diffDays(last, today);
  const grace = cadence === "annual" ? ANNUAL_GRACE_DAYS : MONTHLY_GRACE_DAYS;
  return age >= 0 && age <= grace;
}

type Summary = {
  passed: boolean;
  cadence: "monthly" | "annual";
  occurrences: number;
  streakPassed: boolean;
  recent: boolean;
  stable: boolean;
  dayMatch: boolean;
  last: string | null;
  medianDay: number | null;
  medianAmount: number;
  gapUsed: boolean;
  picked: CandidateTx[];
};

/**
 * `allowSingle`: a known catalog service charged once, recently, still counts.
 * Unknown merchants need a real repetition.
 */
function summarize(txs: CandidateTx[], today: string, allowSingle = false): Summary {
  const amounts = txs.map((tx) => tx.amount);
  const stable = stableAmounts(amounts);
  const medianAmount = amounts.length ? median(amounts) : 0;
  const empty: Summary = {
    passed: false,
    cadence: "monthly",
    occurrences: 0,
    streakPassed: false,
    recent: false,
    stable,
    dayMatch: false,
    last: null,
    medianDay: null,
    medianAmount,
    gapUsed: false,
    picked: [],
  };
  if (!stable || txs.length === 0) return empty;

  const monthly = monthlyStreak(txs.map((tx) => tx.chargeDate));
  if (monthly) {
    const picked = onePerMonth(txs, monthly.months);
    const last = picked.at(-1)?.chargeDate ?? null;
    const days = picked.map((tx) => dayOf(tx.chargeDate));
    const medianDay = days.length ? median(days) : null;
    const dayMatch = medianDay !== null && days.every((day) => dayDistance(day, medianDay) <= DAY_WINDOW);
    const recent = last !== null && recentEnough(last, today, "monthly");
    return {
      passed: recent && picked.length >= MIN_MONTHLY_OCCURRENCES,
      cadence: "monthly",
      occurrences: picked.length,
      streakPassed: picked.length >= MIN_MONTHLY_OCCURRENCES,
      recent,
      stable,
      dayMatch,
      last,
      medianDay,
      medianAmount,
      gapUsed: monthly.gapUsed,
      picked,
    };
  }

  const yearly = annualDates(txs.map((tx) => tx.chargeDate));
  if (yearly) {
    const wanted = new Set(yearly);
    const picked = txs.filter((tx) => wanted.has(tx.chargeDate)).sort((a, b) => a.chargeDate.localeCompare(b.chargeDate));
    const last = picked.at(-1)?.chargeDate ?? null;
    const days = picked.map((tx) => dayOf(tx.chargeDate));
    const medianDay = days.length ? median(days) : null;
    const dayMatch = medianDay !== null && days.every((day) => dayDistance(day, medianDay) <= DAY_WINDOW);
    const recent = last !== null && recentEnough(last, today, "annual");
    return {
      passed: recent && picked.length >= MIN_ANNUAL_OCCURRENCES,
      cadence: "annual",
      occurrences: picked.length,
      streakPassed: picked.length >= MIN_ANNUAL_OCCURRENCES,
      recent,
      stable,
      dayMatch,
      last,
      medianDay,
      medianAmount,
      gapUsed: false,
      picked,
    };
  }

  if (allowSingle) {
    const latest = [...txs].sort((a, b) => a.chargeDate.localeCompare(b.chargeDate)).at(-1);
    if (latest && recentEnough(latest.chargeDate, today, "monthly")) {
      return {
        passed: true,
        cadence: "monthly",
        occurrences: 1,
        streakPassed: false,
        recent: true,
        stable,
        dayMatch: false,
        last: latest.chargeDate,
        medianDay: null,
        medianAmount: latest.amount,
        gapUsed: false,
        picked: [latest],
      };
    }
  }

  return empty;
}

function streakDetail(summary: Summary): string {
  if (summary.occurrences === 0) return "sem repetição";
  if (summary.occurrences === 1 && summary.cadence === "monthly") return "1 cobrança recente";
  if (summary.cadence === "annual") {
    return summary.occurrences === 1 ? "1 cobrança anual" : `${summary.occurrences} cobranças anuais`;
  }
  if (summary.gapUsed) return `${summary.occurrences} cobranças mensais`;
  return summary.occurrences === 1 ? "1 mês" : `${summary.occurrences} meses seguidos`;
}

export function confidenceFor(input: {
  summary: Summary;
  catalog: boolean;
  catalogName: string;
}): Confidence {
  const last = input.summary.last;
  return buildConfidence({
    streakPassed: input.summary.streakPassed,
    occurrences: input.summary.occurrences,
    cadence: input.summary.cadence,
    streakDetail: streakDetail(input.summary),
    dayPassed: input.summary.dayMatch,
    dayDetail:
      input.summary.dayMatch && input.summary.medianDay !== null
        ? `sempre perto do dia ${input.summary.medianDay}`
        : input.summary.occurrences === 1
          ? "só uma cobrança"
          : "dias variados",
    amountPassed: input.summary.stable && input.summary.picked.length > 0,
    amountDetail: input.summary.stable && input.summary.medianAmount > 0 ? formatBrl(round2(input.summary.medianAmount)) : "valores variados",
    catalogPassed: input.catalog,
    catalogDetail: input.catalog ? input.catalogName : "fora do catálogo",
    recentPassed: input.summary.recent,
    recentDetail: last ? `última em ${formatDayMonth(last)}` : "sem cobrança recente",
  });
}

function titleCase(normalized: string): string {
  return normalized
    .toLowerCase()
    .split(" ")
    .filter((word) => !["subscr", "subscription", "bill", "com"].includes(word))
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function planTitle(service: string | null, descriptor: string, amount: number): string {
  if (!service) return titleCase(descriptor) || "Assinatura";
  const words = descriptorWords(descriptor);
  if (service === "apple-one" && words.includes("ICLOUD") && !words.includes("ONE")) return "iCloud";
  return planNameFor(service, amount);
}

function detectionFromCluster(txs: CandidateTx[], service: string | null, today: string, known = false): Detection | null {
  const summary = summarize(txs, today, known || Boolean(service && service !== "apple"));
  if (!summary.passed || !summary.last) return null;
  const descriptor = merchantDescriptor(txs[0]?.description ?? "");
  const info = service ? serviceInfo(service) : undefined;
  const amount = round2(summary.medianAmount);
  const confidence = confidenceFor({
    summary,
    catalog: Boolean(info && service !== "apple"),
    catalogName: info?.serviceName ?? "Assinatura",
  });
  const bucket = Math.round(amount * 100);
  const merchantKey = service ? service : `unknown:${descriptor}:${bucket}`;
  return {
    merchantKey,
    service: service ?? "unknown",
    planName: planTitle(service, descriptor, amount),
    amount,
    approximate: service ? isForeignService(service) : txs.some((tx) => tx.foreignCharge),
    checked: confidence.score >= 80,
    autoConfirmed: false,
    confirm: false,
    planChangeNotice: null,
    descriptors: [...new Set(txs.map((tx) => normalizeDescriptor(tx.description)))],
    suggestionLabel: streakDetail(summary),
    charges: summary.picked.map((charge) => ({
      transactionId: charge.id,
      chargeDate: charge.chargeDate,
      amount: round2(charge.amount),
    })),
    expectedChargeDate: summary.last,
    cadence: summary.cadence,
    confidenceScore: confidence.score,
    confidenceLabel: confidence.label,
    checks: confidence.checks,
  };
}

/**
 * A merchant the user already confirmed. Its charges are recognized from the
 * statement text alone, even a single charge after a pause, with no catalog
 * row: this is how the app learns the user's routine.
 */
export type KnownMerchant = { merchantKey: string; service: string; descriptors: string[] };

export function knownMerchants(subscriptions: { status: string; merchantKey: string; service: string; descriptors: string[] }[]): KnownMerchant[] {
  return subscriptions
    .filter((item) => (item.status === "confirmed" || item.status === "cancelled") && item.descriptors.length > 0)
    .map((item) => ({
      merchantKey: item.merchantKey,
      service: item.service,
      descriptors: [...new Set(item.descriptors.map((descriptor) => merchantDescriptor(descriptor)))],
    }));
}

export function detect(
  transactions: CandidateTx[],
  ignored: string[] = [],
  today = todayInSaoPaulo(),
  known: KnownMerchant[] = [],
): Detection[] {
  const { merchants, descriptors } = parseIgnored(ignored);
  const knownBy = new Map<string, KnownMerchant>();
  for (const merchant of known) for (const descriptor of merchant.descriptors) knownBy.set(descriptor, merchant);
  const usable = transactions.filter((tx) => {
    if (excludedKind(tx)) return false;
    const service = classifyDescriptor(tx.description);
    if (!service && isGenericDescriptor(tx.description)) return false;
    if (descriptors.has(normalizeDescriptor(tx.description))) return false;
    return true;
  });

  const groups = new Map<string, { service: string | null; known: KnownMerchant | null; txs: CandidateTx[] }>();
  for (const tx of usable) {
    const service = classifyDescriptor(tx.description);
    const mine = knownBy.get(merchantDescriptor(tx.description)) ?? null;
    const key = mine ? `known:${mine.merchantKey}` : (service ?? `raw:${merchantDescriptor(tx.description)}`);
    const group = groups.get(key) ?? { service: mine && mine.service !== "unknown" ? mine.service : service, known: mine, txs: [] };
    group.txs.push(tx);
    groups.set(key, group);
  }

  const found: Detection[] = [];
  for (const group of groups.values()) {
    const clusters = clusterStable(group.txs)
      .map((cluster) => detectionFromCluster(cluster, group.service, today, Boolean(group.known)))
      .filter((item): item is Detection => item !== null);
    if (group.known) {
      clusters.sort((a, b) => b.expectedChargeDate.localeCompare(a.expectedChargeDate));
      const best = clusters[0];
      if (best && !merchants.has(group.known.merchantKey)) {
        best.merchantKey = group.known.merchantKey;
        found.push(best);
      }
      continue;
    }
    if (group.service) {
      clusters.sort((a, b) => b.expectedChargeDate.localeCompare(a.expectedChargeDate));
      const best = clusters[0];
      if (best && !merchants.has(group.service)) {
        best.merchantKey = group.service;
        found.push(best);
      }
      continue;
    }
    for (const item of clusters) {
      if (!merchants.has(item.merchantKey)) found.push(item);
    }
  }

  found.sort((a, b) => b.confidenceScore - a.confidenceScore || a.planName.localeCompare(b.planName, "pt-BR"));
  return found;
}

/** Score already-stored charges the same way the detector does, for the card UI. */
export function scoreStoredCharges(input: {
  charges: { chargeDate: string; amount: number }[];
  today: string;
  service: string;
  planName: string;
}): Confidence {
  const txs: CandidateTx[] = input.charges.map((charge, index) => ({
    id: `stored-${index}`,
    description: input.planName,
    amount: charge.amount,
    chargeDate: charge.chargeDate,
  }));
  const known = input.service !== "apple" && input.service !== "unknown" && Boolean(serviceInfo(input.service));
  const summary = summarize(txs, input.today, known);
  const info = serviceInfo(input.service);
  return confidenceFor({
    summary,
    catalog: Boolean(info && input.service !== "apple" && input.service !== "unknown"),
    catalogName: info?.serviceName ?? input.planName,
  });
}
