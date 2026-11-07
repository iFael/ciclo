import { createHash, timingSafeEqual } from "crypto";

export function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

export function safeLog(input: Record<string, unknown>): {
  count: number;
  status: string;
  errorCode: string | null;
} {
  return {
    count: typeof input.count === "number" ? input.count : 0,
    status: typeof input.status === "string" ? input.status : "unknown",
    errorCode: typeof input.errorCode === "string" ? input.errorCode : null,
  };
}

export class ConfigError extends Error {
  constructor(name: string) {
    super(`Configuração incompleta: ${name}`);
    this.name = "ConfigError";
  }
}

const SESSION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function sessionExpired(lastSeenMs: number, nowMs: number): boolean {
  return nowMs - lastSeenMs >= SESSION_WINDOW_MS;
}

export const LAST_SEEN_COOKIE = "recontei_last_seen";
export const LEGACY_LAST_SEEN_COOKIE = "ciclo_last_seen";

export function lastSeenCookie(value: string, secure: boolean): string {
  const secureFlag = secure ? "; Secure" : "";
  return `${LAST_SEEN_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${secureFlag}`;
}

export function clearLastSeenCookie(secure: boolean, name = LAST_SEEN_COOKIE): string {
  const secureFlag = secure ? "; Secure" : "";
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`;
}

export async function endAllSessions(client: {
  auth: { signOut: (args: { scope: "global" }) => Promise<unknown> };
}): Promise<void> {
  await client.auth.signOut({ scope: "global" });
}
