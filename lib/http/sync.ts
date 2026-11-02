import { resolveDeps } from "@/lib/deps";
import { isAuthorized } from "@/lib/http/gate";
import { prepareScreen } from "@/lib/present";
import { ConfigError, safeLog } from "@/lib/security";
import { storeLogoCache } from "@/lib/store";
import { SyncStepError, syncAll } from "@/lib/sync";
import {
  countNewSuggestions,
  newestSyncedAt,
  rateLimitMessage,
  retryAfterSeconds,
  suggestedIds,
  suggestionSummary,
} from "@/lib/sync-policy";

export async function handleManualSync(_request?: Request): Promise<Response> {
  try {
    if (!(await isAuthorized())) return Response.json({ error: "unauthorized" }, { status: 401 });
    const deps = await resolveDeps();
    const before = await deps.store.load();
    const wait = retryAfterSeconds(newestSyncedAt(before.connections), deps.now());
    if (wait > 0) {
      return Response.json(
        { error: rateLimitMessage(wait), retryAfterSeconds: wait },
        { status: 429, headers: { "Retry-After": String(wait), "Cache-Control": "no-store" } },
      );
    }
    const known = suggestedIds(before.subscriptions);
    const sync = await syncAll(deps);
    if (!sync.ok) {
      const code = sync.code ?? "sync_failed";
      console.info(JSON.stringify(safeLog({ count: 0, status: "error", errorCode: code })));
      return Response.json({ error: "Não foi possível sincronizar agora.", code }, { status: 502 });
    }
    const after = await deps.store.load();
    const newSuggestions = countNewSuggestions(known, suggestedIds(after.subscriptions));
    const screen = await prepareScreen(after, deps.now(), storeLogoCache(deps.store));
    return Response.json(
      { ok: true, newSuggestions, message: suggestionSummary(newSuggestions), screen },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ConfigError) return Response.json({ error: error.message }, { status: 503 });
    const code = error instanceof SyncStepError ? error.step : "sync_failed";
    console.info(JSON.stringify(safeLog({ count: 0, status: "error", errorCode: code })));
    return Response.json({ error: "Não foi possível sincronizar agora.", code }, { status: 500 });
  }
}
