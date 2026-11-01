import { applyAction, type PlanAction } from "@/lib/actions";
import { resolveDeps } from "@/lib/deps";
import { isAuthorized } from "@/lib/http/gate";
import { buildScreen } from "@/lib/screen";
import { ConfigError, safeLog } from "@/lib/security";

const ACTIONS = new Set([
  "confirm",
  "ignore",
  "pick-apple",
  "remove",
  "undo",
  "still-paying",
  "cancelled",
  "restore-charging",
  "ignore-charging",
]);

export async function handlePlans(request: Request): Promise<Response> {
  try {
    if (!(await isAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
    const deps = await resolveDeps();
    const state = await deps.store.load();
    if (request.method === "GET") return Response.json(buildScreen(state, deps.now()));
    const body = (await request.json()) as Partial<PlanAction> & { service?: string };
    if (!body.action || !ACTIONS.has(body.action) || !("id" in body) || !body.id) {
      return Response.json({ error: "Ação inválida." }, { status: 400 });
    }
    const next = applyAction(state, body as PlanAction, deps.now());
    await deps.store.save(next);
    return Response.json(buildScreen(next, deps.now()));
  } catch (error) {
    if (error instanceof ConfigError) return Response.json({ error: error.message }, { status: 503 });
    console.info(JSON.stringify(safeLog({ count: 0, status: "error", errorCode: "plans_failed" })));
    return Response.json({ error: "Não foi possível carregar seus planos." }, { status: 500 });
  }
}
