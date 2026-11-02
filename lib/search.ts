import { mergeDetections } from "@/lib/actions";
import { serviceInfo } from "@/lib/catalog";
import { formatBrl, formatDayMonthYear, round2 } from "@/lib/format";
import { classifyDescriptor, detect, excludedKind, isAppleBill, merchantIgnoreToken, type CandidateTx } from "@/lib/matching";
import { merchantDescriptor, normalizeDescriptor } from "@/lib/text";
import type { AppState, StoredTx } from "@/lib/types";

/**
 * Search the stored statement (the whole history window, ~14 months) and group
 * the hits by merchant, so the user can say "this is a subscription" for
 * something the detector missed. What they confirm here becomes a known
 * merchant and is recognized on its own from then on.
 */

export const SEARCH_MIN_LENGTH = 2;
const MAX_GROUPS = 20;
const MAX_CHARGES = 14;

export type SearchGroup = {
  key: string;
  name: string;
  count: number;
  months: number;
  amountLabel: string;
  lastLabel: string;
  status: "plan" | "suggested" | "ignored" | null;
  charges: { date: string; label: string; amount: string }[];
};

function titleCase(normalized: string): string {
  return normalized
    .toLowerCase()
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const APPLE_KEY = "apple";

/** One search group per service: spellings of the same merchant stay together. */
export function searchKeyOf(description: string): string {
  if (isAppleBill(description)) return APPLE_KEY;
  const service = classifyDescriptor(description);
  return service ? `svc:${service}` : merchantDescriptor(description);
}

function serviceOfKey(key: string): string | null {
  if (key === APPLE_KEY) return "apple";
  return key.startsWith("svc:") ? key.slice(4) : null;
}

function statusOf(state: AppState, key: string, descriptors: Set<string>): SearchGroup["status"] {
  const service = serviceOfKey(key);
  for (const subscription of state.subscriptions) {
    const mine =
      subscription.descriptors.some((descriptor) => descriptors.has(merchantDescriptor(descriptor))) ||
      (service !== null && service !== "apple" && subscription.service === service);
    if (!mine) continue;
    if (subscription.status === "confirmed") return "plan";
    if (subscription.status === "suggested") return "suggested";
    if (subscription.status === "ignored") return "ignored";
  }
  return null;
}

export function searchStatement(state: AppState, rows: StoredTx[], query: string): SearchGroup[] {
  const needle = normalizeDescriptor(query);
  if (needle.length < SEARCH_MIN_LENGTH) return [];
  const compact = needle.replace(/ /g, "");
  const groups = new Map<string, StoredTx[]>();
  for (const row of rows) {
    if (excludedKind(row)) continue;
    const text = normalizeDescriptor(row.description);
    if (!text.includes(needle) && !text.replace(/ /g, "").includes(compact)) continue;
    const key = searchKeyOf(row.description);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) => b.chargeDate.localeCompare(a.chargeDate));
      const amounts = sorted.map((row) => row.amount);
      const min = Math.min(...amounts);
      const max = Math.max(...amounts);
      const service = serviceOfKey(key);
      const descriptors = new Set(sorted.map((row) => merchantDescriptor(row.description)));
      return {
        key,
        name: service ? (serviceInfo(service)?.serviceName ?? titleCase(merchantDescriptor(sorted[0].description))) : titleCase(key),
        count: sorted.length,
        months: new Set(sorted.map((row) => row.chargeDate.slice(0, 7))).size,
        amountLabel: Math.abs(max - min) < 0.005 ? formatBrl(round2(min)) : `${formatBrl(round2(min))} a ${formatBrl(round2(max))}`,
        lastLabel: formatDayMonthYear(sorted[0].chargeDate),
        status: statusOf(state, key, descriptors),
        charges: sorted.slice(0, MAX_CHARGES).map((row) => ({ date: row.chargeDate, label: formatDayMonthYear(row.chargeDate), amount: formatBrl(round2(row.amount)) })),
        sortDate: sorted[0].chargeDate,
      };
    })
    .sort((a, b) => b.sortDate.localeCompare(a.sortDate) || b.count - a.count)
    .slice(0, MAX_GROUPS)
    .map(({ sortDate: _sortDate, ...group }) => group);
}

/**
 * Confirm a merchant found by search. Its charges in the latest stable price
 * group become a confirmed plan. Recency is not required: the user said so.
 */
export function confirmFromSearch(input: AppState, rows: StoredTx[], key: string, today: string): AppState {
  const mine: CandidateTx[] = rows
    .filter((row) => !excludedKind(row) && searchKeyOf(row.description) === key)
    .map((row) => ({ id: row.id, description: row.description, amount: row.amount, chargeDate: row.chargeDate, foreignCharge: row.foreignCharge }));
  if (mine.length === 0) return input;
  const state = structuredClone(input);
  const descriptors = [...new Set(mine.map((row) => merchantDescriptor(row.description)))];
  state.ignoredDescriptors = state.ignoredDescriptors.filter((item) => !descriptors.includes(merchantDescriptor(item)));
  const latest = [...mine].sort((a, b) => b.chargeDate.localeCompare(a.chargeDate))[0];
  // Score as if today were the day after the last charge, so an old plan the user picks still forms a detection.
  const asOf = latest.chargeDate < today ? nextDay(latest.chargeDate) : today;
  const service = serviceOfKey(key);
  const known = service === "apple" ? [] : [{ merchantKey: service ?? `unknown:${key}`, service: service ?? "unknown", descriptors }];
  // Apple bills split by price; the latest one is the plan the user means.
  const forced = detect(mine, [], asOf, known).sort((a, b) => b.expectedChargeDate.localeCompare(a.expectedChargeDate));
  const detection = forced[0];
  if (!detection) return input;
  const existing = state.subscriptions.find((item) => item.merchantKey === detection.merchantKey);
  if (existing && (existing.status === "ignored" || existing.status === "cancelled")) {
    existing.status = "suggested";
    state.ignoredDescriptors = state.ignoredDescriptors.filter((item) => item !== merchantIgnoreToken(existing.merchantKey));
  }
  const merged = mergeDetections(state, [{ ...detection, confirm: true, autoConfirmed: false }], true);
  const row = merged.subscriptions.find((item) => item.merchantKey === detection.merchantKey);
  if (row && row.status !== "confirmed") {
    row.status = "confirmed";
    row.suggestionLabel = null;
    row.dismissedAt = null;
  }
  return merged;
}

function nextDay(iso: string): string {
  const date = new Date(`${iso}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
