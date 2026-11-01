import { resolveDeps } from "@/lib/deps";
import { lastSyncAgeHours } from "@/lib/format";
import { ConfigError, safeEqual, safeLog } from "@/lib/security";

export async function handleHealth(request: Request): Promise<Response> {
  const secret = process.env.HEALTH_TOKEN;
  if (!secret) return Response.json({ error: "Configuração incompleta: HEALTH_TOKEN" }, { status: 503 });
  const header = request.headers.get("authorization") ?? "";
  if (!safeEqual(header, `Bearer ${secret}`)) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const deps = await resolveDeps();
    const state = await deps.store.load();
    const times = state.connections.map((connection) => connection.lastSyncedAt).filter((value): value is string => !!value);
    times.sort();
    return Response.json({ lastSyncAgeHours: lastSyncAgeHours(times.at(-1) ?? null, deps.now()) });
  } catch (error) {
    if (error instanceof ConfigError) return Response.json({ error: error.message }, { status: 503 });
    console.info(JSON.stringify(safeLog({ count: 0, status: "error", errorCode: "health_failed" })));
    return Response.json({ error: "Não foi possível ler a sincronização." }, { status: 500 });
  }
}
