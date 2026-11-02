import { resolveDeps } from "@/lib/deps";
import { isAuthorized } from "@/lib/http/gate";
import { weeklySummary } from "@/lib/reminders";
import { ConfigError, safeLog } from "@/lib/security";

const COOLDOWN_MS = 60_000;
let lastSentAt = 0;

export function resetSummaryCooldownForTests(): void {
  lastSentAt = 0;
}

/** Sends the weekly summary now, on demand. It does not count as this week's automatic summary. */
export async function handleSummaryEmail(_request?: Request): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  try {
    if (!(await isAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401, headers });
    const deps = await resolveDeps();
    const now = deps.now();
    const wait = Math.ceil((lastSentAt + COOLDOWN_MS - now.getTime()) / 1000);
    if (lastSentAt && wait > 0) {
      return Response.json(
        { error: "O resumo acabou de ser enviado. Espere um minuto para mandar de novo." },
        { status: 429, headers: { ...headers, "Retry-After": String(wait) } },
      );
    }
    const state = await deps.store.load();
    await deps.sendEmail(weeklySummary(state, now));
    lastSentAt = now.getTime();
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    if (error instanceof ConfigError) return Response.json({ error: "E-mail não configurado." }, { status: 503, headers });
    console.info(JSON.stringify(safeLog({ count: 0, status: "email", errorCode: "email_failed" })));
    return Response.json({ error: "Não foi possível enviar o e-mail agora." }, { status: 502, headers });
  }
}
