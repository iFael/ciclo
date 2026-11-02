import { HISTORY_MONTHS } from "@/lib/rules";

const DAY = 24 * 60 * 60 * 1000;

export function parseCivil(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function formatCivil(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const date = parseCivil(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return formatCivil(date);
}

export function diffDays(from: string, to: string): number {
  return Math.round((parseCivil(to).getTime() - parseCivil(from).getTime()) / DAY);
}

export function addMonthsClamp(iso: string, months: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const clamped = Math.min(day, last);
  return formatCivil(new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), clamped)));
}

export function saoPauloCivilDate(isoTimestamp: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(isoTimestamp));
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function todayInSaoPaulo(now = new Date()): string {
  return saoPauloCivilDate(now.toISOString());
}

export function isoWeekKey(iso: string): string {
  const date = parseCivil(iso);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / DAY + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function windowStart(today: string, _firstSync: boolean): string {
  return addMonthsClamp(today, -HISTORY_MONTHS);
}

export type TransactionQuery = {
  accountId: string;
  dateFrom?: string;
  createdAtFrom?: string;
};

/**
 * A connection last read before this moment is read again from the start of
 * the history window. Bump it when the import rules change, so rows the old
 * rules dropped (bank debits, intermediary descriptors) come back.
 */
export const FULL_REREAD_BEFORE = "2026-11-02T06:00:00.000Z";

export function transactionQueries(input: {
  accountId: string;
  lastSyncedAt: string | null;
  today: string;
}): TransactionQuery[] {
  if (!input.lastSyncedAt || input.lastSyncedAt < FULL_REREAD_BEFORE) {
    return [{ accountId: input.accountId, dateFrom: addMonthsClamp(input.today, -HISTORY_MONTHS) }];
  }
  const created = new Date(input.lastSyncedAt);
  created.setTime(created.getTime() - DAY);
  return [
    { accountId: input.accountId, createdAtFrom: created.toISOString() },
    { accountId: input.accountId, dateFrom: addDays(input.today, -35) },
  ];
}
