import { diffDays } from "@/lib/dates";
import { formatDayMonth } from "@/lib/format";
import { ANNUAL_GRACE_DAYS, MONTHLY_GRACE_DAYS } from "@/lib/rules";
import type { AppState } from "@/lib/types";

export type Cadence = "monthly" | "annual";

export function chargeDates(state: AppState, subscriptionId: string): string[] {
  return state.charges
    .filter((charge) => charge.subscriptionId === subscriptionId)
    .map((charge) => charge.chargeDate)
    .sort();
}

export function latestChargeDate(state: AppState, subscriptionId: string): string | null {
  return chargeDates(state, subscriptionId).at(-1) ?? null;
}

/** Annual when the stored charges are a year apart rather than monthly. */
export function cadenceOf(dates: string[]): Cadence {
  if (dates.length < 2) return "monthly";
  const sorted = [...dates].sort();
  const gap = diffDays(sorted[0], sorted[sorted.length - 1]);
  const months = new Set(sorted.map((date) => date.slice(0, 7))).size;
  if (months <= 3 && gap >= 330) return "annual";
  return "monthly";
}

export function graceDays(cadence: Cadence): number {
  return cadence === "annual" ? ANNUAL_GRACE_DAYS : MONTHLY_GRACE_DAYS;
}

export function isStaleCharge(last: string, today: string, cadence: Cadence): boolean {
  const age = diffDays(last, today);
  return age > graceDays(cadence);
}

/**
 * Label for a confirmed plan. Never says "Próxima cobrança".
 * A future date is not shown as a last charge.
 */
export function lastChargeLabel(last: string | null, today: string, cadence: Cadence = "monthly"): string {
  if (!last || diffDays(last, today) < 0) return "Sem cobrança recente";
  const text = `Última cobrança: ${formatDayMonth(last)}`;
  if (isStaleCharge(last, today, cadence)) return `${text} · Sem cobrança recente`;
  return text;
}
