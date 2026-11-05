import { resolveDeps } from "@/lib/deps";
import { deliverReminders } from "@/lib/deliver";
import { syncItem } from "@/lib/sync";
import { pluggyWebhookSchema, type PluggyWebhook } from "@/lib/pluggy/schemas";
import { ConfigError, safeEqual, safeLog } from "@/lib/security";
import { triggerFactsBankSync } from "@/lib/facts-bridge";

export function webhookAuthorized(request: Request, secret: string): boolean {
  const url = new URL(request.url);
  const header = request.headers.get("x-webhook-token") ?? request.headers.get("x-pluggy-token");
  const query = url.searchParams.get("token");
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.toLowerCase().startsWith("bearer ") ? authorization.slice(7) : null;
  const presented = header || query || bearer;
  if (!presented) return false;
  return safeEqual(presented, secret);
}

// shortcut: the re-read finishes before the 200, upgrade to waitUntil if Pluggy times out.
export async function handleWebhook(request: Request): Promise<Response> {
  const secret = process.env.PLUGGY_WEBHOOK_TOKEN;
  if (!secret) return Response.json({ error: "Configuração incompleta: PLUGGY_WEBHOOK_TOKEN" }, { status: 503 });
  if (!webhookAuthorized(request, secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
  let body: PluggyWebhook;
  try {
    const parsed = pluggyWebhookSchema.safeParse(await request.json());
    // A notice we cannot read is acknowledged and ignored, like before. The cron re-reads anyway.
    if (!parsed.success) {
      console.info(JSON.stringify(safeLog({ count: 0, status: "ignored", errorCode: "webhook_invalid_body" })));
      return Response.json({ ok: true });
    }
    body = parsed.data;
  } catch {
    return Response.json({ ok: true });
  }
  if (!body.itemId) return Response.json({ ok: true });
  try {
    const deps = await resolveDeps();
    if (!deps.pluggy) return Response.json({ error: "Configuração incompleta: PLUGGY_CLIENT_ID" }, { status: 503 });
    await syncItem(deps, body.itemId, body.event ?? "item/updated", body.transactionIds ?? []);
    await triggerFactsBankSync(body.event ?? "item/updated", body.transactionIds ?? []);
    try {
      await deliverReminders(deps);
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
    }
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof ConfigError) return Response.json({ error: error.message }, { status: 503 });
    console.info(JSON.stringify(safeLog({ count: 0, status: "error", errorCode: "webhook_failed" })));
    return Response.json({ error: "Falha ao processar o aviso." }, { status: 500 });
  }
}
