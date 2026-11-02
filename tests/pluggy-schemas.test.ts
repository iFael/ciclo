import { afterEach, describe, expect, it, vi } from "vitest";
import { setDepsForTests, type AppDeps } from "@/lib/deps";
import { handleWebhook } from "@/lib/http/webhook";
import { createMemoryStore } from "@/lib/memory-store";
import { PluggyClient } from "@/lib/pluggy/client";
import { PluggyShapeError, pluggyTransactionSchema, pluggyWebhookSchema } from "@/lib/pluggy/schemas";
import type { PluggySource } from "@/lib/pluggy/client";

function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function client(routes: (url: string) => unknown) {
  return new PluggyClient({
    clientId: "id",
    clientSecret: "secret",
    fetchImpl: async (url) => (url.endsWith("/auth") ? json({ apiKey: "memory-key" }) : json(routes(url))),
  });
}

afterEach(() => {
  setDepsForTests(null);
  delete process.env.PLUGGY_WEBHOOK_TOKEN;
  vi.restoreAllMocks();
});

describe("pluggy transaction schema", () => {
  it("accepts a normal row, turns null into missing and drops unknown card metadata", () => {
    const row = pluggyTransactionSchema.parse({
      id: "tx-1",
      description: "NETFLIX.COM",
      amount: 55.9,
      date: "2026-10-15T00:00:00.000Z",
      currencyCode: null,
      category: null,
      creditCardMetadata: { transactionDateTime: "2026-10-15T03:10:00.000Z", payeeMCC: 4899, cardNumber: "1234", billId: "bill" },
      balance: 1000,
    });
    expect(row.currencyCode).toBeUndefined();
    expect(row.category).toBeNull();
    expect(row.creditCardMetadata).toEqual({ transactionDateTime: "2026-10-15T03:10:00.000Z", payeeMCC: 4899 });
    expect(row).not.toHaveProperty("balance");
  });

  it("reads a numeric string amount as a number", () => {
    expect(pluggyTransactionSchema.parse({ id: "tx", amount: "21.90", date: "2026-10-01" }).amount).toBe(21.9);
  });

  it("refuses rows without a usable amount or date", () => {
    expect(pluggyTransactionSchema.safeParse({ id: "tx", amount: "abc", date: "2026-10-01" }).success).toBe(false);
    expect(pluggyTransactionSchema.safeParse({ id: "tx", amount: 10, date: "" }).success).toBe(false);
    expect(pluggyTransactionSchema.safeParse({ id: "tx", amount: 10, date: "ontem" }).success).toBe(false);
    expect(pluggyTransactionSchema.safeParse({ id: "", amount: 10, date: "2026-10-01" }).success).toBe(false);
  });
});

describe("pluggy client validation", () => {
  it("keeps the good rows of a page and logs only how many were dropped", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const rows = await client(() => ({
      results: [
        { id: "a", amount: 10, date: "2026-10-01" },
        { id: "b", amount: "oops", date: "2026-10-02", description: "SEGREDO DO CARTAO" },
        { id: "c", amount: 12, date: "2026-10-03" },
      ],
      next: null,
    })).listTransactions({ accountId: "acc", dateFrom: "2026-10-01" });
    expect(rows.map((row) => row.id)).toEqual(["a", "c"]);
    const logged = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain('"count":1');
    expect(logged).toContain("pluggy_invalid_transaction");
    expect(logged).not.toContain("SEGREDO");
  });

  it("fails clearly when the page itself has the wrong shape", async () => {
    await expect(client(() => ({ results: "nope" })).listTransactions({ accountId: "acc", dateFrom: "2026-10-01" })).rejects.toBeInstanceOf(
      PluggyShapeError,
    );
  });

  it("fails clearly when an item has no usable id, naming the field and not the value", async () => {
    const error = await client(() => ({ id: 42, status: "UPDATED" }))
      .getItem("item-1")
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(PluggyShapeError);
    expect((error as PluggyShapeError).message).toBe("pluggy_invalid_item");
    expect((error as PluggyShapeError).issues.join(" ")).toContain("id");
  });

  it("encodes the item id in the URL", async () => {
    const urls: string[] = [];
    await client((url) => {
      urls.push(url);
      return { id: "item-1" };
    }).getItem("item-1");
    expect(urls).toEqual(["https://api.pluggy.ai/items/item-1"]);
  });

  it("refuses a login answer without an api key", async () => {
    const bad = new PluggyClient({ clientId: "id", clientSecret: "secret", fetchImpl: async () => json({ apiKey: "" }) });
    await expect(bad.getItem("item-1")).rejects.toThrow("pluggy_auth_failed");
  });
});

describe("webhook body validation", () => {
  it("only accepts item ids made of id characters", () => {
    expect(pluggyWebhookSchema.safeParse({ event: "item/updated", itemId: "b5c2e1f0-1234-4cde-9abc-001122334455" }).success).toBe(true);
    expect(pluggyWebhookSchema.safeParse({ event: "item/updated", itemId: "../accounts?x=1" }).success).toBe(false);
  });

  it("acknowledges and ignores a notice with a bad item id without calling Pluggy", async () => {
    process.env.PLUGGY_WEBHOOK_TOKEN = "webhook-test-token";
    vi.spyOn(console, "info").mockImplementation(() => {});
    const calls: string[] = [];
    const source: PluggySource = {
      async getItem(id) {
        calls.push(id);
        return { id };
      },
      async getAccounts() {
        return [];
      },
      async listTransactions() {
        return [];
      },
    };
    const deps: AppDeps = { store: createMemoryStore(), pluggy: source, now: () => new Date(), userEmail: "owner@example.com", sendEmail: async () => {} };
    setDepsForTests(deps);
    const response = await handleWebhook(
      new Request("http://localhost/api/webhooks/pluggy", {
        method: "POST",
        headers: { "x-webhook-token": "webhook-test-token", "content-type": "application/json" },
        body: JSON.stringify({ event: "item/updated", itemId: "../accounts" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(calls).toEqual([]);
  });
});
