import { deliverReminders } from "@/lib/deliver";
import { resolveDeps } from "@/lib/deps";
import { syncAll } from "@/lib/sync";
import { ConfigError, safeEqual, safeLog } from "@/lib/security";

export async function handleCron(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "Configuração incompleta: CRON_SECRET" }, { status: 503 });
  const header = request.headers.get("authorization") ?? "";
  if (!safeEqual(header, `Bearer ${secret}`)) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const deps = await resolveDeps();
    const sync = await syncAll(deps);
    let sent = 0;
    let message = sync.message;
    try {
      sent = await deliverReminders(deps);
    } catch (error) {
      if (error instanceof ConfigError) message = error.message;
      else throw error;
    }
    return Response.json({ ok: sync.ok, sent, message });
  } catch (error) {
    if (error instanceof ConfigError) return Response.json({ error: error.message }, { status: 503 });
    console.info(JSON.stringify(safeLog({ count: 0, status: "error", errorCode: "cron_failed" })));
    return Response.json({ error: "Falha ao sincronizar." }, { status: 500 });
  }
}
