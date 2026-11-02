import type { Subscription } from "@/lib/types";

/** Manual and automatic syncs share this server-side gap. */
export const SYNC_COOLDOWN_MS = 2 * 60 * 1000;

/** A backgrounded PWA counts as opened again after this long away. */
export const FOREGROUND_AWAY_MS = 15 * 1000;

export function newestSyncedAt(connections: { lastSyncedAt: string | null }[]): string | null {
  const times = connections.map((connection) => connection.lastSyncedAt).filter((value): value is string => !!value);
  times.sort();
  return times.at(-1) ?? null;
}

export function suggestedIds(subscriptions: Pick<Subscription, "id" | "status">[]): string[] {
  return subscriptions.filter((subscription) => subscription.status === "suggested").map((subscription) => subscription.id);
}

export function countNewSuggestions(beforeIds: Iterable<string>, afterIds: Iterable<string>): number {
  const before = new Set(beforeIds);
  let count = 0;
  for (const id of afterIds) if (!before.has(id)) count += 1;
  return count;
}

export function suggestionSummary(count: number): string {
  if (count <= 0) return "Nada novo";
  if (count === 1) return "1 nova sugestão";
  return `${count} novas sugestões`;
}

/** Seconds until another sync is allowed. Zero means it can run now. */
export function retryAfterSeconds(lastSyncedAt: string | null, now: Date): number {
  if (!lastSyncedAt) return 0;
  const elapsed = now.getTime() - new Date(lastSyncedAt).getTime();
  if (!Number.isFinite(elapsed) || elapsed >= SYNC_COOLDOWN_MS) return 0;
  return Math.max(1, Math.ceil((SYNC_COOLDOWN_MS - Math.max(elapsed, 0)) / 1000));
}

export function waitPhrase(seconds: number): string {
  const total = Math.max(1, Math.ceil(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes <= 0) return `${rest} s`;
  if (rest === 0) return minutes === 1 ? "1 minuto" : `${minutes} minutos`;
  const minLabel = minutes === 1 ? "1 min" : `${minutes} min`;
  return `${minLabel} ${rest} s`;
}

export function rateLimitMessage(seconds: number): string {
  return `Você pode sincronizar de novo em ${waitPhrase(seconds)}.`;
}

export function shouldStartAutoSync(input: {
  inFlight: boolean;
  lastSyncedAt: string | null;
  now: number;
  reason: "load" | "foreground";
  hiddenForMs?: number;
}): boolean {
  if (input.inFlight) return false;
  if (retryAfterSeconds(input.lastSyncedAt, new Date(input.now)) > 0) return false;
  if (input.reason === "foreground" && (input.hiddenForMs ?? 0) < FOREGROUND_AWAY_MS) return false;
  return true;
}
