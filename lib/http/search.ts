import { windowStart, todayInSaoPaulo } from "@/lib/dates";
import { resolveDeps } from "@/lib/deps";
import { isAuthorized } from "@/lib/http/gate";
import { prepareScreen } from "@/lib/present";
import { confirmFromSearch, searchStatement } from "@/lib/search";
import { ConfigError, safeLog } from "@/lib/security";
import { storeLogoCache } from "@/lib/store";

const MAX_QUERY = 60;

export async function handleSearch(request: Request): Promise<Response> {
  try {
    if (!(await isAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
    const deps = await resolveDeps();
    const state = await deps.store.load();
    const today = todayInSaoPaulo(deps.now());
    const rows = await deps.store.transactionsSince(windowStart(today, false));
    if (request.method === "GET") {
      const query = (new URL(request.url).searchParams.get("q") ?? "").slice(0, MAX_QUERY);
      return Response.json({ groups: searchStatement(state, rows, query) });
    }
    const body = (await request.json().catch(() => ({}))) as { key?: unknown };
    const key = typeof body.key === "string" ? body.key.slice(0, 200) : "";
    if (!key) return Response.json({ error: "Busca inválida." }, { status: 400 });
    const next = confirmFromSearch(state, rows, key, today);
    if (next === state) return Response.json({ error: "Nada encontrado para confirmar." }, { status: 404 });
    await deps.store.save(next);
    return Response.json(await prepareScreen(next, deps.now(), storeLogoCache(deps.store)));
  } catch (error) {
    if (error instanceof ConfigError) return Response.json({ error: error.message }, { status: 503 });
    console.info(JSON.stringify(safeLog({ count: 0, status: "error", errorCode: "search_failed" })));
    return Response.json({ error: "Não foi possível buscar no extrato." }, { status: 500 });
  }
}
