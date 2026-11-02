import { applyAction, type PlanAction } from "@/lib/actions";
import { resolveDeps } from "@/lib/deps";
import { isAuthorized } from "@/lib/http/gate";
import { normalizeDomain } from "@/lib/logos/infer";
import { resolveLogo, adaptFetch } from "@/lib/logos/resolve";
import { prepareScreen } from "@/lib/present";
import { ConfigError, safeLog } from "@/lib/security";
import { storeLogoCache } from "@/lib/store";

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
  "set-domain",
]);

export async function handlePlans(request: Request): Promise<Response> {
  try {
    if (!(await isAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
    const deps = await resolveDeps();
    const state = await deps.store.load();
    const cache = storeLogoCache(deps.store);
    if (request.method === "GET") return Response.json(await prepareScreen(state, deps.now(), cache));
    const body = (await request.json()) as Partial<PlanAction> & { service?: string; domain?: string; replaces?: unknown };
    if (!body.action || !ACTIONS.has(body.action) || !("id" in body) || !body.id) {
      return Response.json({ error: "Ação inválida." }, { status: 400 });
    }
    if (body.action === "set-domain") {
      const domain = normalizeDomain(body.domain ?? "");
      const subscription = state.subscriptions.find((item) => item.id === body.id);
      if (!domain || !subscription) return Response.json({ error: "Ação inválida." }, { status: 400 });
      await resolveLogo({
        merchantKey: subscription.merchantKey,
        service: subscription.service,
        descriptor: subscription.descriptors[0] ?? subscription.planName,
        domainOverride: domain,
        bypassCatalog: true,
        now: deps.now(),
        cache,
        fetchImpl: adaptFetch(fetch),
      });
      return Response.json(await prepareScreen(state, deps.now(), cache));
    }
    const command = { ...body, replaces: typeof body.replaces === "string" ? body.replaces : undefined } as PlanAction;
    const next = applyAction(state, command, deps.now());
    await deps.store.save(next);
    return Response.json(await prepareScreen(next, deps.now(), cache));
  } catch (error) {
    if (error instanceof ConfigError) return Response.json({ error: error.message }, { status: 503 });
    console.info(JSON.stringify(safeLog({ count: 0, status: "error", errorCode: "plans_failed" })));
    return Response.json({ error: "Não foi possível carregar seus planos." }, { status: 500 });
  }
}
