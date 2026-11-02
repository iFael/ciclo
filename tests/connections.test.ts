import { afterEach, describe, expect, it } from "vitest";
import { setDepsForTests, type AppDeps } from "@/lib/deps";
import { handleConnections } from "@/lib/http/connections";
import { createMemoryStore } from "@/lib/memory-store";
import type { PluggySource } from "@/lib/pluggy/client";
import { PluggyClient } from "@/lib/pluggy/client";
import { accountSummary, itemIdsForRun, replaceSiblings } from "@/lib/pluggy/map";
import { screenConnections } from "@/lib/screen";
import { syncAll, syncItem } from "@/lib/sync";
import type { Connection } from "@/lib/types";

const NOW = new Date("2026-11-02T15:00:00.000Z");

function row(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "conn-1",
    itemId: "item-1",
    institution: "MeuPluggy",
    connectorId: "200",
    status: "active",
    consentExpiresAt: "2027-11-01T00:00:00.000Z",
    lastSyncedAt: null,
    lastErrorCode: null,
    lastSyncHadData: false,
    lastDataThrough: null,
    accounts: [],
    ...overrides,
  };
}

function source(accounts: Record<string, unknown[]> = {}): PluggySource & { deleted: string[]; tokens: (string | undefined)[] } {
  const deleted: string[] = [];
  const tokens: (string | undefined)[] = [];
  return {
    deleted,
    tokens,
    async getItem(id) {
      return { id, status: "UPDATED", connector: { id: "200", name: "MeuPluggy" }, consentExpiresAt: "2027-11-01T00:00:00.000Z" };
    },
    async getAccounts(itemId) {
      return (accounts[itemId] ?? []) as Awaited<ReturnType<PluggySource["getAccounts"]>>;
    },
    async listTransactions() {
      return [];
    },
    async createConnectToken(itemId) {
      tokens.push(itemId);
      return "connect-token";
    },
    async deleteItem(itemId) {
      deleted.push(itemId);
    },
  };
}

function useDeps(store: ReturnType<typeof createMemoryStore>, pluggy: PluggySource, userEmail: string | null = "owner@example.com") {
  const deps: AppDeps = { store, pluggy, now: () => NOW, userEmail, sendEmail: async () => {} };
  setDepsForTests(deps);
  return deps;
}

function post(body: unknown) {
  return new Request("http://localhost/api/connections", { method: "POST", body: JSON.stringify(body) });
}

afterEach(() => setDepsForTests(null));

describe("cards of a connection", () => {
  it("keeps the card name, brand and last four digits only", () => {
    const card = accountSummary({
      id: "acc-1",
      type: "CREDIT",
      subtype: "CREDIT_CARD",
      name: "Mercado Pago",
      number: "5502 **** **** 1234",
      creditData: { brand: "MASTERCARD", level: "GOLD" },
    });
    expect(card).toEqual({ id: "acc-1", kind: "card", name: "Mercado Pago", brand: "Mastercard", last4: "1234" });
    const account = accountSummary({ id: "acc-2", type: "BANK", subtype: "CHECKING_ACCOUNT", marketingName: "Conta Mercado Pago", number: "0001/12345-6" });
    expect(account).toEqual({ id: "acc-2", kind: "account", name: "Conta Mercado Pago", brand: null, last4: null });
  });

  it("stores the cards on the read and shows them instead of MeuPluggy", async () => {
    const store = createMemoryStore({ connections: [row()] });
    const deps = useDeps(
      store,
      source({ "item-1": [{ id: "acc-1", type: "CREDIT", name: "Mercado Pago", number: "1234", creditData: { brand: "MASTERCARD" } }] }),
    );
    await syncAll(deps);
    const state = await store.load();
    expect(state.connections[0]?.accounts).toEqual([{ id: "acc-1", kind: "card", name: "Mercado Pago", brand: "Mastercard", last4: "1234" }]);
    const [shown] = screenConnections(state.connections);
    expect(shown?.title).toBe("Mercado Pago");
    expect(shown?.via).toBe("Pelo MeuPluggy");
    expect(shown?.accounts[0]?.detail).toBe("Cartão de crédito · Mastercard · final 1234");
    expect(JSON.stringify(shown)).not.toContain("item-1");
  });

  it("hides removed and replaced connections", () => {
    const shown = screenConnections([row(), row({ id: "c2", itemId: "i2", status: "removed" }), row({ id: "c3", itemId: "i3", status: "replaced" })]);
    expect(shown.map((connection) => connection.id)).toEqual(["conn-1"]);
  });
});

describe("more than one bank through MeuPluggy", () => {
  it("a second bank does not replace the first", async () => {
    const store = createMemoryStore({
      connections: [row({ accounts: [{ id: "a", kind: "card", name: "Mercado Pago", brand: "Mastercard", last4: "1234" }] })],
    });
    const deps = useDeps(store, source({ "item-2": [{ id: "b", type: "CREDIT", name: "Nubank", number: "9876" }] }));
    await syncItem(deps, "item-2", "item/created");
    const state = await store.load();
    expect(state.connections.map((connection) => connection.status)).toEqual(["active", "active"]);
    expect(itemIdsForRun(state.connections).sort()).toEqual(["item-1", "item-2"]);
  });

  it("the same bank connected again replaces the old item", async () => {
    const store = createMemoryStore({
      connections: [row({ status: "expired", accounts: [{ id: "a", kind: "card", name: "Mercado Pago", brand: null, last4: "1234" }] })],
    });
    const deps = useDeps(store, source({ "item-2": [{ id: "a2", type: "CREDIT", name: "Mercado Pago", number: "1234" }] }));
    await syncItem(deps, "item-2", "item/created");
    const state = await store.load();
    expect(state.connections.find((connection) => connection.itemId === "item-1")?.status).toBe("replaced");
  });

  it("a bank's own connector still replaces its older item right away", () => {
    const connections = [row({ institution: "Nubank", connectorId: "nu" }), row({ id: "c2", itemId: "item-2", institution: "Nubank", connectorId: "nu" })];
    const next = replaceSiblings(connections, { id: "item-2", connector: { id: "nu", name: "Nubank" } });
    expect(next.find((connection) => connection.itemId === "item-1")?.status).toBe("replaced");
  });

  it("item/deleted from Pluggy marks the connection removed without reading it", async () => {
    const store = createMemoryStore({ connections: [row()] });
    const pluggy = source();
    pluggy.getItem = async () => {
      throw new Error("pluggy_404");
    };
    const deps = useDeps(store, pluggy);
    await syncItem(deps, "item-1", "item/deleted");
    expect((await store.load()).connections[0]?.status).toBe("removed");
  });
});

describe("/api/connections", () => {
  it("needs a session", async () => {
    useDeps(createMemoryStore({ connections: [row()] }), source(), null);
    expect((await handleConnections(post({ action: "token" }))).status).toBe(401);
  });

  it("gives a token for a new bank without any item id", async () => {
    const pluggy = source();
    useDeps(createMemoryStore({ connections: [row()] }), pluggy);
    const response = await handleConnections(post({ action: "token" }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.accessToken).toBe("connect-token");
    expect(body.updateItem).toBeUndefined();
    expect(body.selectedConnectorId).toBe(200);
    expect(pluggy.tokens).toEqual([undefined]);
  });

  it("renews by connection id and hands the widget that item only", async () => {
    const pluggy = source();
    useDeps(createMemoryStore({ connections: [row()] }), pluggy);
    const body = (await (await handleConnections(post({ action: "token", id: "conn-1" }))).json()) as Record<string, unknown>;
    expect(body.updateItem).toBe("item-1");
    expect(pluggy.tokens).toEqual(["item-1"]);
    expect((await handleConnections(post({ action: "token", id: "nope" }))).status).toBe(404);
  });

  it("removes at Pluggy, keeps the row as removed and stops reading it", async () => {
    const store = createMemoryStore({ connections: [row()] });
    const pluggy = source();
    useDeps(store, pluggy);
    const response = await handleConnections(post({ action: "remove", id: "conn-1" }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { screen: { connections: unknown[] } };
    expect(body.screen.connections).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("item-1");
    expect(pluggy.deleted).toEqual(["item-1"]);
    const state = await store.load();
    expect(state.connections[0]?.status).toBe("removed");
    expect(itemIdsForRun(state.connections, "seed")).toEqual([]);
  });
});

describe("pluggy client, connect token and delete", () => {
  it("sends the item to renew and treats a missing item as already removed", async () => {
    const calls: { url: string; method?: string; body?: string }[] = [];
    const client = new PluggyClient({
      clientId: "id",
      clientSecret: "secret",
      fetchImpl: async (url, init) => {
        calls.push({ url, method: init?.method, body: init?.body });
        if (url.endsWith("/auth")) return { ok: true, status: 200, json: async () => ({ apiKey: "k" }) };
        if (url.endsWith("/connect_token")) return { ok: true, status: 200, json: async () => ({ accessToken: "t" }) };
        return { ok: false, status: 404, json: async () => ({}) };
      },
    });
    expect(await client.createConnectToken("item-9")).toBe("t");
    const tokenCall = calls.find((call) => call.url.endsWith("/connect_token"));
    expect(JSON.parse(tokenCall?.body ?? "{}")).toEqual({ itemId: "item-9" });
    await expect(client.deleteItem("gone")).resolves.toBeUndefined();
    expect(calls.at(-1)).toMatchObject({ method: "DELETE" });
  });
});
