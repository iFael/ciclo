import { factsFeedTransactions } from "@/lib/facts-feed";
import { resolveDeps } from "@/lib/deps";
import { ConfigError, safeEqual, safeLog } from "@/lib/security";
import { syncAll } from "@/lib/sync";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function handleFactsFeed(request: Request): Promise<Response> {
  const secret = process.env.FACTS_FEED_TOKEN;
  if (!secret) return Response.json({ error: "feed_unconfigured" }, { status: 503 });

  const authorization = request.headers.get("authorization") ?? "";
  if (!safeEqual(authorization, `Bearer ${secret}`)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? "";
  const name = url.searchParams.get("name")?.trim() || null;
  const refresh = url.searchParams.get("refresh") !== "0";

  if (!DATE_RE.test(from) || Number.isNaN(Date.parse(`${from}T00:00:00.000Z`))) {
    return Response.json({ error: "invalid_from" }, { status: 400 });
  }
  if (name && name.length > 160) {
    return Response.json({ error: "invalid_name" }, { status: 400 });
  }

  try {
    const deps = await resolveDeps();
    if (refresh) {
      const sync = await syncAll(deps);
      if (!sync.ok) {
        return Response.json(
          { error: "bank_sync_failed", code: sync.code ?? "sync_failed" },
          { status: 502, headers: { "Cache-Control": "no-store" } },
        );
      }
    }

    const [rows, state] = await Promise.all([deps.store.transactionsSince(from), deps.store.load()]);
    const institutions = new Map(state.connections.map((connection) => [connection.itemId, connection.institution]));
    const transactions = factsFeedTransactions(rows, name).map((transaction) => ({
      ...transaction,
      institution: institutions.get(transaction.itemId) ?? null,
    }));
    return Response.json(
      { ok: true, transactions },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ConfigError) {
      return Response.json({ error: "feed_unconfigured" }, { status: 503 });
    }
    console.info(JSON.stringify(safeLog({ count: 0, status: "error", errorCode: "facts_feed_failed" })));
    return Response.json({ error: "facts_feed_failed" }, { status: 500 });
  }
}
