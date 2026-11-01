export function round2(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function formatBrl(amount: number): string {
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const cents = Math.round(abs * 100);
  const whole = cents % 100 === 0;
  const intPart = Math.floor(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const body = whole ? intPart : `${intPart},${String(cents % 100).padStart(2, "0")}`;
  return `${negative ? "-" : ""}R$ ${body}`;
}

export function formatDayMonth(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

export function formatDayMonthYear(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

export function daysPhrase(days: number): string {
  if (days === 0) return "hoje";
  if (days === 1) return "em 1 dia";
  if (days > 1) return `em ${days} dias`;
  if (days === -1) return "há 1 dia";
  return `há ${Math.abs(days)} dias`;
}

export function lastSyncAgeHours(lastSyncedAt: string | null, now: Date): number | null {
  if (!lastSyncedAt) return null;
  const hours = (now.getTime() - new Date(lastSyncedAt).getTime()) / 36e5;
  return Math.round(hours * 10) / 10;
}
