import { applyAction, cleanManageUrl, type PlanAction } from "@/lib/actions";
import { serviceInfo } from "@/lib/catalog";
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
  "set-manage-url",
]);

/** Store pages manage many services: their logo is the store's, not the plan's. */
const STORE_HOSTS = ["apple.com", "google.com"];

/**
 * The site of the link the user chose, to fetch the plan's logo from. Null
 * for a store page, and for the service's own catalog site, whose logo is
 * already the catalog's.
 */
export function logoDomainFromLink(link: string, service: string): string | null {
  const domain = normalizeDomain(link);
  if (!domain) return null;
  const within = (host: string) => domain === host || domain.endsWith(`.${host}`);
  if (STORE_HOSTS.some(within)) return null;
  if ((serviceInfo(service)?.domains ?? []).some(within)) return null;
  return domain;
}

async function pinLogo(
  subscription: { merchantKey: string; service: string; descriptors: string[]; planName: string },
  domain: string,
  now: Date,
  cache: ReturnType<typeof storeLogoCache>,
): Promise<void> {
  await resolveLogo({
    merchantKey: subscription.merchantKey,
    service: subscription.service,
    descriptor: subscription.descriptors[0] ?? subscription.planName,
    domainOverride: domain,
    bypassCatalog: true,
    now,
    cache,
    fetchImpl: adaptFetch(fetch),
  });
}

export async function handlePlans(request: Request): Promise<Response> {
  try {
    if (!(await isAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
    const deps = await resolveDeps();
    const state = await deps.store.load();
    const cache = storeLogoCache(deps.store);
    if (request.method === "GET") return Response.json(await prepareScreen(state, deps.now(), cache));
    const body = (await request.json()) as Partial<PlanAction> & { service?: string; domain?: string; replaces?: unknown; url?: unknown };
    if (!body.action || !ACTIONS.has(body.action) || !("id" in body) || !body.id) {
      return Response.json({ error: "Ação inválida." }, { status: 400 });
    }
    if (body.action === "set-domain") {
      const domain = normalizeDomain(body.domain ?? "");
      const subscription = state.subscriptions.find((item) => item.id === body.id);
      if (!domain || !subscription) return Response.json({ error: "Ação inválida." }, { status: 400 });
      await pinLogo(subscription, domain, deps.now(), cache);
      return Response.json(await prepareScreen(state, deps.now(), cache));
    }
    if (body.action === "set-manage-url" && (typeof body.url !== "string" || cleanManageUrl(body.url) === undefined)) {
      return Response.json({ error: "Link inválido. Use um endereço https." }, { status: 400 });
    }
    const command = { ...body, replaces: typeof body.replaces === "string" ? body.replaces : undefined } as PlanAction;
    const next = applyAction(state, command, deps.now());
    await deps.store.save(next);
    if (body.action === "set-manage-url") {
      const subscription = next.subscriptions.find((item) => item.id === body.id);
      const domain = subscription?.manageUrl ? logoDomainFromLink(subscription.manageUrl, subscription.service) : null;
      if (subscription && domain) await pinLogo(subscription, domain, deps.now(), cache);
    }
    return Response.json(await prepareScreen(next, deps.now(), cache));
  } catch (error) {
    if (error instanceof ConfigError) return Response.json({ error: error.message }, { status: 503 });
    console.info(JSON.stringify(safeLog({ count: 0, status: "error", errorCode: "plans_failed" })));
    return Response.json({ error: "Não foi possível carregar seus planos." }, { status: 500 });
  }
}
