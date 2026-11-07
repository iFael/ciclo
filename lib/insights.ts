import { addMonthsClamp } from "@/lib/dates";
import { round2 } from "@/lib/format";
import type { AppState } from "@/lib/types";

export type SpendingMonth = { month: string; total: number };
export type SpendingTrend = { percent: number; current: number; previous: number };

/** Recorded charges from confirmed plans, excluding the incomplete current month. */
export function spendingHistory(state: AppState, today: string): {
  months: SpendingMonth[];
  trend: SpendingTrend | null;
} {
  const ids = new Set(state.subscriptions.filter((plan) => plan.status === "confirmed").map((plan) => plan.id));
  const totals = new Map<string, number>();
  const seen = new Set<string>();
  for (const charge of state.charges) {
    const month = charge.chargeDate.slice(0, 7);
    if (!ids.has(charge.subscriptionId) || month >= today.slice(0, 7)) continue;
    if (seen.has(charge.transactionId)) continue;
    seen.add(charge.transactionId);
    totals.set(month, (totals.get(month) ?? 0) + charge.amount);
  }
  const months = [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([month, total]) => ({ month, total: round2(total) }));
  const previous = months.at(-2);
  const current = months.at(-1);
  // Gaps and zero baselines cannot establish a meaningful month-on-month percentage.
  const sequential = previous && current && addMonthsClamp(previous.month + "-01", 1).slice(0, 7) === current.month;
  const trend = sequential && previous.total > 0
    ? { percent: Math.sign(current.total - previous.total) * Math.round(Math.abs(((current.total - previous.total) / previous.total) * 100)), previous: previous.total, current: current.total }
    : null;
  return { months, trend };
}
