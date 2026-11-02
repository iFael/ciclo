import { resolveDeps } from "@/lib/deps";
import { isAuthorized } from "@/lib/http/gate";
import { isAggregator } from "@/lib/pluggy/map";
import { prepareScreen } from "@/lib/present";
import { ConfigError, safeLog } from "@/lib/security";
import { storeLogoCache } from "@/lib/store";

type Body = { action?: unknown; id?: unknown };

const noStore = { "Cache-Control": "no-store" };

/**
 * Conexões: a token for the Pluggy Connect widget and removing a connection.
 * The screen only knows the connection row id. A new or renewed item reaches
 * the server through the Pluggy webhook, like before. The one exception is
 * renewing: the widget needs the item it renews, so that one id goes back to
 * the browser in that answer only.
 */
export async function handleConnections(request: Request): Promise<Response> {
  try {
    if (!(await isAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
    const deps = await resolveDeps();
    if (!deps.pluggy) return Response.json({ error: "Configuração incompleta: PLUGGY_CLIENT_ID" }, { status: 503 });
    const pluggy = deps.pluggy;
    let body: Body;
    try {
      body = (await request.json()) as Body;
    } catch {
      return Response.json({ error: "Ação inválida." }, { status: 400 });
    }
    const state = await deps.store.load();
    const byId = (id: unknown) =>
      typeof id === "string" ? state.connections.find((row) => row.id === id && row.status !== "removed" && row.status !== "replaced") : undefined;

    if (body.action === "token") {
      if (!pluggy.createConnectToken) return Response.json({ error: "Indisponível." }, { status: 503 });
      const connection = body.id === undefined ? undefined : byId(body.id);
      if (body.id !== undefined && !connection) return Response.json({ error: "Conexão não encontrada." }, { status: 404 });
      const accessToken = await pluggy.createConnectToken(connection?.itemId);
      // Renewing needs the widget to know which item. Only that one, only on request.
      // A new bank goes through MeuPluggy, so the widget can skip the connector list.
      const aggregator = state.connections.find((row) => isAggregator(row.institution) && /^\d+$/.test(row.connectorId ?? ""));
      const selectedConnectorId = connection || !aggregator ? undefined : Number(aggregator.connectorId);
      return Response.json({ accessToken, updateItem: connection?.itemId, selectedConnectorId }, { headers: noStore });
    }

    if (body.action === "remove") {
      const connection = byId(body.id);
      if (!connection) return Response.json({ error: "Conexão não encontrada." }, { status: 404 });
      if (pluggy.deleteItem) await pluggy.deleteItem(connection.itemId);
      connection.status = "removed";
      await deps.store.save(state);
      const screen = await prepareScreen(state, deps.now(), storeLogoCache(deps.store));
      return Response.json({ ok: true, screen }, { headers: noStore });
    }

    return Response.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    if (error instanceof ConfigError) return Response.json({ error: error.message }, { status: 503 });
    console.info(JSON.stringify(safeLog({ count: 0, status: "error", errorCode: "connections_failed" })));
    return Response.json({ error: "Não foi possível falar com a Pluggy agora." }, { status: 502 });
  }
}
