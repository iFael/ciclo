import { afterEach, describe, expect, it } from "vitest";
import { setDepsForTests } from "@/lib/deps";
import { transactionQueries } from "@/lib/dates";
import { createMemoryStore } from "@/lib/memory-store";
import { PluggyClient } from "@/lib/pluggy/client";
import { itemIdsForRun } from "@/lib/pluggy/map";
import { syncAll } from "@/lib/sync";
import type { Connection } from "@/lib/types";

const NOW = new Date("2026-11-01T15:00:00.000Z");

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

afterEach(() => setDepsForTests(null));

describe("pluggy client", () => {
  it("follows next until null and never sends pageSize", async () => {
    const urls: string[] = [];
    const client = new PluggyClient({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl: async (url) => {
        urls.push(url);
        if (url.endsWith("/auth")) return json({ apiKey: "memory-key" });
        if (urls.filter((item) => item.includes("/v2/transactions")).length === 1) {
          return json({ results: [{ id: "a", amount: 1, date: "2026-01-01" }], next: "?accountId=acc&after=page2" });
        }
        if (urls.filter((item) => item.includes("/v2/transactions")).length === 2) {
          return json({ results: [{ id: "b", amount: 1, date: "2026-01-02" }], next: "?accountId=acc&after=page3" });
        }
        return json({ results: [{ id: "c", amount: 1, date: "2026-01-03" }], next: null });
      },
    });
    const rows = await client.listTransactions({ accountId: "acc", dateFrom: "2026-01-01" });
    expect(rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(urls.some((url) => url.includes("pageSize"))).toBe(false);
    expect(urls.some((url) => url.includes("after=page2"))).toBe(true);
    expect(urls.some((url) => url.includes("after=page3"))).toBe(true);
  });

  it("refuses to send dateFrom together with createdAtFrom", async () => {
    let called = false;
    const client = new PluggyClient({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl: async () => {
        called = true;
        return json({});
      },
    });
    await expect(
      client.listTransactions({ accountId: "acc", dateFrom: "2026-01-01", createdAtFrom: "2026-01-01T00:00:00.000Z" }),
    ).rejects.toThrow(/juntos/);
    expect(called).toBe(false);
  });

  it("splits incremental and reread queries", () => {
    const first = transactionQueries({ accountId: "acc", lastSyncedAt: null, today: "2026-11-01" });
    const next = transactionQueries({ accountId: "acc", lastSyncedAt: "2026-11-01T12:00:00.000Z", today: "2026-11-01" });
    expect(first).toEqual([{ accountId: "acc", dateFrom: "2025-09-01" }]);
    expect(next[0]).toEqual({ accountId: "acc", createdAtFrom: "2026-10-31T12:00:00.000Z" });
    expect(next[1]).toEqual({ accountId: "acc", dateFrom: "2026-09-27" });
    for (const query of [...first, ...next]) {
      expect(Boolean(query.dateFrom && query.createdAtFrom)).toBe(false);
    }
  });
});

describe("sync", () => {
  it("dedupes the createdAtFrom overlap and reads item ids from the table", async () => {
    const queries: Array<{ dateFrom?: string; createdAtFrom?: string }> = [];
    const seen: string[] = [];
    const store = createMemoryStore({
      connections: [
        {
          id: "conn-1",
          itemId: "item-table",
          institution: "Banco teste",
          connectorId: "bank",
          status: "active",
          consentExpiresAt: "2027-06-01T00:00:00.000Z",
          lastSyncedAt: "2026-10-20T12:00:00.000Z",
          lastErrorCode: null,
          lastSyncHadData: false,
          lastDataThrough: null,
        } satisfies Connection,
      ],
    });
    await syncAll({
      store,
      now: () => NOW,
      seedItemId: "item-seed-should-not-be-used",
      pluggy: {
        async getItem(id) {
          seen.push(id);
          return { id, status: "UPDATED", connector: { id: "bank", name: "Banco teste" }, consentExpiresAt: "2027-06-01T00:00:00.000Z" };
        },
        async getAccounts() {
          return [{ id: "acc", type: "CREDIT" }];
        },
        async listTransactions(query) {
          queries.push(query);
          return [{ id: "tx-overlap", description: "OPENAI *CHATGPT SUBSCR", amount: 110, date: "2026-10-15T00:00:00.000Z", accountId: "acc", currencyCode: "BRL" }];
        },
      },
    });
    expect(seen).toEqual(["item-table"]);
    expect(queries).toHaveLength(2);
    expect(queries.some((query) => query.dateFrom && query.createdAtFrom)).toBe(false);
    expect(await store.transactionsSince("2020-01-01")).toHaveLength(1);
    expect(itemIdsForRun([], "item-seed")).toEqual(["item-seed"]);
    expect(itemIdsForRun([{ itemId: "item-table", status: "active" } as Connection], "item-seed")).toEqual(["item-table"]);
  });
});
