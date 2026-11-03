import { dropShadowedSuggestions, mergeDetections } from "@/lib/actions";
import { serviceInfo } from "@/lib/catalog";
import { formatBrl, formatDayMonthYear, round2 } from "@/lib/format";
import { classifyDescriptor, detect, isAppleBill, merchantIgnoreToken, type CandidateTx } from "@/lib/matching";
import { merchantDescriptor, normalizeDescriptor } from "@/lib/text";
import { canLinkPayment, isPix, paymentKey } from "@/lib/payment-identity";
import { withinPercent } from "@/lib/matching";
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
  charges: { id: string; date: string; label: string; amount: string; description: string }[];
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
export function searchKeyOf(description: string, transaction?: StoredTx): string {
  if (transaction && isPix(transaction)) return `payee:${paymentKey(transaction)}`;
  if (isAppleBill(description)) return APPLE_KEY;
  const service = classifyDescriptor(description);
  return service ? `svc:${service}` : merchantDescriptor(description);
}

function serviceOfKey(key: string): string | null {
  if (key === APPLE_KEY) return "apple";
  return key.startsWith("svc:") ? key.slice(4) : null;
}

function statusOf(state: AppState, key: string, descriptors: Set<string>, txIds: Set<string>): SearchGroup["status"] {
  if (state.charges.some((charge) => txIds.has(charge.transactionId) && state.subscriptions.some((plan) => plan.id === charge.subscriptionId && plan.status === "confirmed"))) return "plan";
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
    if (!canLinkPayment(row)) continue;
    const text = normalizeDescriptor([row.description, row.descriptionRaw, row.merchantName, row.counterpartyName].filter(Boolean).join(" "));
    if (!text.includes(needle) && !text.replace(/ /g, "").includes(compact)) continue;
    const key = searchKeyOf(row.description, row);
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
        name: service ? (serviceInfo(service)?.serviceName ?? titleCase(merchantDescriptor(sorted[0].description))) : titleCase(key.startsWith("payee:") ? key.slice(6) : key),
        count: sorted.length,
        months: new Set(sorted.map((row) => row.chargeDate.slice(0, 7))).size,
        amountLabel: Math.abs(max - min) < 0.005 ? formatBrl(round2(min)) : `${formatBrl(round2(min))} a ${formatBrl(round2(max))}`,
        lastLabel: formatDayMonthYear(sorted[0].chargeDate),
        status: statusOf(state, key, descriptors, new Set(sorted.map((row) => row.id))),
        charges: sorted.slice(0, MAX_CHARGES).map((row) => ({ id: row.id, date: row.chargeDate, label: formatDayMonthYear(row.chargeDate), amount: formatBrl(round2(row.amount)), description: row.description })),
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
    .filter((row) => canLinkPayment(row) && searchKeyOf(row.description, row) === key)
    .map((row) => ({ id: row.id, description: row.description, amount: row.amount, chargeDate: row.chargeDate, foreignCharge: row.foreignCharge, type: row.type, category: row.category, operationType: row.operationType, status: row.status, paymentMethod: row.paymentMethod, merchantName: row.merchantName, counterpartyName: row.counterpartyName, counterpartyKind: row.counterpartyKind }));
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
  return dropShadowedSuggestions(merged);
}

/** Explicit user-approved payments, never silently inferred from a shared processor name. */
export function linkPaymentsToPlan(
  input: AppState,
  rows: StoredTx[],
  subscriptionId: string,
  selectedIds: string[],
  groupKey: string,
): AppState {
  const plan = input.subscriptions.find((item) => item.id === subscriptionId && item.status === "confirmed");
  const ids = new Set(selectedIds);
  if (!plan || ids.size === 0 || ids.size > 14) return input;
  const selected = rows.filter((tx) => ids.has(tx.id));
  if (selected.length !== ids.size || new Set(selected.map((tx) => tx.chargeDate)).size !== selected.length || selected.some((tx) =>
    searchKeyOf(tx.description, tx) !== groupKey ||
    !canLinkPayment(tx) || !withinPercent(plan.amount, tx.amount, 0.15) ||
    input.charges.some((charge) => charge.transactionId === tx.id || (charge.subscriptionId === plan.id && charge.chargeDate === tx.chargeDate))
  )) return input;
  const state = structuredClone(input);
  const target = state.subscriptions.find((item) => item.id === subscriptionId)!;
  for (const tx of selected) {
    state.charges.push({ subscriptionId, chargeDate: tx.chargeDate, amount: tx.amount, transactionId: tx.id, resolved: false });
  }
  const ordered = selected.toSorted((a, b) => b.chargeDate.localeCompare(a.chargeDate));
  if (!target.expectedChargeDate || ordered[0].chargeDate > target.expectedChargeDate) target.expectedChargeDate = ordered[0].chargeDate;
  // A pattern is learned only from repeated, explicitly confirmed movements of one payee/account.
  const allFromPlan = state.charges.filter((charge) => charge.subscriptionId === subscriptionId);
  for (const tx of selected.filter(isPix)) {
    const key = paymentKey(tx);
    const similar = rows.filter((row) =>
      isPix(row) && canLinkPayment(row) && row.accountId === tx.accountId &&
      paymentKey(row) === key && withinPercent(row.amount, tx.amount, 0.15) &&
      allFromPlan.some((charge) => charge.transactionId === row.id),
    );
    if (new Set(similar.map((row) => row.chargeDate.slice(0, 7))).size < 2) continue;
    const match = { key, accountId: tx.accountId, amount: tx.amount };
    if (!(target.paymentMatches ?? []).some((item) => item.key === key && item.accountId === tx.accountId && withinPercent(item.amount, match.amount, 0.15))) {
      target.paymentMatches = [...(target.paymentMatches ?? []), match];
    }
  }
  return state;
}

/**
 * Move the evidence of a suggested recurring charge to a confirmed plan.
 * The suggestion already owns those transaction IDs, so it must be detached
 * before reusing the existing validated linkPaymentsToPlan path.
 */
export function linkSuggestionToPlan(
  input: AppState,
  rows: StoredTx[],
  suggestionId: string,
  subscriptionId: string,
): AppState {
  const suggestion = input.subscriptions.find((item) => item.id === suggestionId && item.status === "suggested");
  const target = input.subscriptions.find((item) => item.id === subscriptionId && item.status === "confirmed");
  if (!suggestion || !target || suggestion.id === target.id) return input;

  const evidence = input.charges.filter((charge) => charge.subscriptionId === suggestionId);
  const ids = evidence.map((charge) => charge.transactionId);
  if (ids.length === 0 || ids.length > 14 || new Set(ids).size !== ids.length) return input;

  const selected = rows.filter((tx) => ids.includes(tx.id));
  if (selected.length !== ids.length) return input;
  const groupKey = searchKeyOf(selected[0].description, selected[0]);
  if (selected.some((tx) => searchKeyOf(tx.description, tx) !== groupKey)) return input;

  const detached = structuredClone(input);
  detached.subscriptions = detached.subscriptions.filter((item) => item.id !== suggestionId);
  detached.charges = detached.charges.filter((charge) => charge.subscriptionId !== suggestionId);

  const linked = linkPaymentsToPlan(detached, rows, subscriptionId, ids, groupKey);
  if (linked === detached) return input;

  const plan = linked.subscriptions.find((item) => item.id === subscriptionId)!;
  const months = new Set(selected.map((tx) => tx.chargeDate.slice(0, 7)));
  const latest = [...selected].sort((a, b) => b.chargeDate.localeCompare(a.chargeDate))[0];
  // Replace an FX estimate only when two or more confirmed months agree on
  // an actual BRL amount; never guess a new price from a single payment.
  if (plan.approximate && months.size >= 2 && selected.every((tx) =>
    !tx.foreignCharge && withinPercent(tx.amount, latest.amount, 0.05)
  )) {
    plan.amount = round2(latest.amount);
    plan.approximate = false;
  }
  return dropShadowedSuggestions(linked);
}

function nextDay(iso: string): string {
  const date = new Date(`${iso}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
