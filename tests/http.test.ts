import { afterEach, describe, expect, it } from "vitest";
import { setDepsForTests, type AppDeps } from "@/lib/deps";
import { handleCron } from "@/lib/http/cron";
import { handleHealth } from "@/lib/http/health";
import { handleLogout } from "@/lib/http/logout";
import { HttpFailure } from "@/lib/http/failure";
import { handleMagicLink } from "@/lib/http/magic-link";
import { handleWebhook } from "@/lib/http/webhook";
import { createMemoryStore } from "@/lib/memory-store";
import { planReminders } from "@/lib/reminders";
import type { PluggySource } from "@/lib/pluggy/client";

type Item = {
  id: string;
  status?: string;
  consentExpiresAt?: string | null;
  connector?: { id?: string; name?: string };
  error?: { code?: string } | null;
};

const NOW = new Date("2026-11-01T15:00:00.000Z");

function pluggy(items: Record<string, Item>): PluggySource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async getItem(id) {
      calls.push(id);
      return items[id];
    },
    async getAccounts() {
      return [];
    },
    async listTransactions() {
      return [];
    },
  };
}

function deps(store = createMemoryStore(), source: PluggySource | null = pluggy({})): AppDeps & { mail: string[] } {
  const mail: string[] = [];
  const value: AppDeps & { mail: string[] } = {
    store,
    pluggy: source,
    now: () => NOW,
    userEmail: "owner@example.com",
    mail,
    sendEmail: async (message) => {
      mail.push(message.text);
    },
  };
  setDepsForTests(value);
  return value;
}

afterEach(() => {
  setDepsForTests(null);
  delete process.env.CRON_SECRET;
  delete process.env.HEALTH_TOKEN;
  delete process.env.PLUGGY_WEBHOOK_TOKEN;
});

function request(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) {
  return new Request(url, init);
}

describe("webhook", () => {
  it("returns 401 without the token and does nothing", async () => {
    process.env.PLUGGY_WEBHOOK_TOKEN = "webhook-test-token";
    const source = pluggy({ A: { id: "A", status: "UPDATED" } });
    deps(createMemoryStore(), source);
    const response = await handleWebhook(request("http://localhost/api/webhooks/pluggy", { method: "POST", body: JSON.stringify({ event: "item/created", itemId: "A" }) }));
    expect(response.status).toBe(401);
    expect(source.calls).toEqual([]);
  });

  it("is idempotent and safe when events arrive out of order", async () => {
    process.env.PLUGGY_WEBHOOK_TOKEN = "webhook-test-token";
    const source = pluggy({
      A: { id: "A", status: "UPDATED", connector: { id: "mp", name: "Banco teste" }, consentExpiresAt: "2027-01-01T00:00:00.000Z" },
    });
    const store = createMemoryStore();
    deps(store, source);
    const headers = { "x-webhook-token": "webhook-test-token", "content-type": "application/json" };
    const updated = await handleWebhook(request("http://localhost/api/webhooks/pluggy", { method: "POST", headers, body: JSON.stringify({ event: "item/updated", itemId: "A" }) }));
    const created = await handleWebhook(request("http://localhost/api/webhooks/pluggy?token=webhook-test-token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "item/created", itemId: "A" }) }));
    const repeated = await handleWebhook(request("http://localhost/api/webhooks/pluggy", { method: "POST", headers, body: JSON.stringify({ event: "item/created", itemId: "A" }) }));
    expect(updated.status).toBe(200);
    expect(created.status).toBe(200);
    expect(repeated.status).toBe(200);
    expect((await store.load()).connections).toHaveLength(1);
  });

  it("replaces the previous connection and alerts when nothing new arrives", async () => {
    process.env.PLUGGY_WEBHOOK_TOKEN = "webhook-test-token";
    const source = pluggy({
      A: { id: "A", status: "UPDATED", connector: { id: "mp", name: "Banco teste" }, consentExpiresAt: "2027-01-01T00:00:00.000Z" },
      B: { id: "B", status: "UPDATED", connector: { id: "mp", name: "Banco teste" }, consentExpiresAt: "2027-02-01T00:00:00.000Z" },
      C: { id: "C", status: "LOGIN_ERROR", error: { code: "USER_AUTHORIZATION_EXPIRED" }, connector: { id: "solo", name: "Outro" } },
    });
    const store = createMemoryStore();
    deps(store, source);
    const headers = { "x-webhook-token": "webhook-test-token", "content-type": "application/json" };
    await handleWebhook(request("http://localhost/api/webhooks/pluggy", { method: "POST", headers, body: JSON.stringify({ event: "item/created", itemId: "A" }) }));
    await handleWebhook(request("http://localhost/api/webhooks/pluggy", { method: "POST", headers, body: JSON.stringify({ event: "item/created", itemId: "B" }) }));
    const connections = (await store.load()).connections;
    expect(connections.find((item) => item.itemId === "A")?.status).toBe("replaced");
    expect(connections.find((item) => item.itemId === "B")?.status).toBe("active");
    await handleWebhook(request("http://localhost/api/webhooks/pluggy", { method: "POST", headers, body: JSON.stringify({ event: "item/error", itemId: "C" }) }));
    const expired = (await store.load()).connections.find((item) => item.itemId === "C");
    expect(expired?.status).toBe("expired");
    const mails = planReminders(await store.load(), new Set(), NOW);
    expect(mails.some((mail) => mail.text.includes("Conexão vencida e nenhum item novo"))).toBe(true);
    expect(mails.some((mail) => mail.text.includes("itemId") || mail.text.includes("\"C\""))).toBe(false);
  });
});

describe("cron and health", () => {
  it("rejects a cron without the bearer token and does not send two weekly emails", async () => {
    process.env.CRON_SECRET = "cron-test-secret";
    const denied = await handleCron(request("http://localhost/api/cron/sync"));
    expect(denied.status).toBe(401);
    const store = createMemoryStore({
      connections: [
        {
          id: "conn-1",
          itemId: "item-should-not-leak",
          institution: "Banco teste",
          connectorId: "bank",
          status: "active",
          consentExpiresAt: "2026-12-01T00:00:00.000Z",
          lastSyncedAt: "2026-11-01T13:00:00.000Z",
          lastErrorCode: null,
          lastSyncHadData: true,
          lastDataThrough: "2026-11-01",
        },
      ],
      subscriptions: [
        {
          id: "sub-1",
          service: "chatgpt",
          planName: "ChatGPT Plus",
          status: "confirmed",
          dismissedAt: null,
          approximate: true,
          merchantKey: "chatgpt",
          amount: 110,
          expectedChargeDate: "2026-11-04",
          checked: false,
          autoConfirmed: false,
          planChangeNotice: null,
          undoStatus: null,
          suppressAutoConfirm: false,
          cancelPromptSnoozeDate: null,
          descriptors: ["OPENAI *CHATGPT SUBSCR"],
          suggestionLabel: null,
        },
      ],
    });
    const runtime = deps(store, null);
    const headers = { authorization: "Bearer cron-test-secret" };
    const first = await handleCron(request("http://localhost/api/cron/sync", { headers }));
    const second = await handleCron(request("http://localhost/api/cron/sync", { headers }));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const weekly = runtime.mail.filter((text) => text.includes("Resumo semanal"));
    expect(weekly).toHaveLength(1);
    expect(runtime.mail.join("\n")).not.toContain("item-should-not-leak");
    expect(runtime.mail.join("\n")).not.toContain("OPENAI *CHATGPT SUBSCR");
    expect(runtime.mail.some((text) => text.includes("ChatGPT Plus"))).toBe(true);
  });

  it("returns only the sync age and 401 without the health token", async () => {
    process.env.HEALTH_TOKEN = "health-test-token";
    const denied = await handleHealth(request("http://localhost/api/health"));
    expect(denied.status).toBe(401);
    deps(
      createMemoryStore({
        connections: [
          {
            id: "conn-1",
            itemId: "item-should-not-leak",
            institution: null,
            connectorId: null,
            status: "active",
            consentExpiresAt: null,
            lastSyncedAt: new Date(NOW.getTime() - 90 * 60 * 1000).toISOString(),
            lastErrorCode: null,
            lastSyncHadData: true,
            lastDataThrough: null,
          },
        ],
      }),
      null,
    );
    const response = await handleHealth(request("http://localhost/api/health", { headers: { authorization: "Bearer health-test-token" } }));
    const body = (await response.json()) as { lastSyncAgeHours: number };
    expect(response.status).toBe(200);
    expect(Object.keys(body)).toEqual(["lastSyncAgeHours"]);
    expect(body.lastSyncAgeHours).toBe(1.5);
  });
});

describe("session", () => {
  it("sends a magic link only for the allowed email", async () => {
    const calls: string[] = [];
    const denied = await handleMagicLink(request("http://localhost/api/auth/magic-link", { method: "POST", body: JSON.stringify({ email: "other@example.com" }) }), {
      allowedEmail: "owner@example.com",
      redirectTo: "http://localhost/auth/callback",
      send: async (email) => {
        calls.push(email);
      },
    });
    expect(denied.status).toBe(403);
    expect(calls).toEqual([]);
    const allowed = await handleMagicLink(request("http://localhost/api/auth/magic-link", { method: "POST", body: JSON.stringify({ email: "Owner@Example.com" }) }), {
      allowedEmail: "owner@example.com",
      redirectTo: "https://ciclo-peach.vercel.app/auth/callback",
      send: async (email) => {
        calls.push(email);
      },
    });
    expect(allowed.status).toBe(200);
    expect(calls).toEqual(["Owner@Example.com"]);
    const limited = await handleMagicLink(request("http://localhost/api/auth/magic-link", { method: "POST", body: JSON.stringify({ email: "owner@example.com" }) }), {
      allowedEmail: "owner@example.com",
      redirectTo: "http://localhost/auth/callback",
      send: async () => {
        throw new HttpFailure(429);
      },
    });
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { error: string }).error).toMatch(/Muitas tentativas/);
  });

  it("clears the session cookie on logout", async () => {
    let signedOut = false;
    deps();
    const runtime = {
      signedOut: false,
    };
    setDepsForTests({
      ...deps(),
      userEmail: "owner@example.com",
      signOut: async () => {
        signedOut = true;
        runtime.signedOut = true;
      },
    });
    const response = await handleLogout();
    expect(response.status).toBe(200);
    expect(signedOut).toBe(true);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    setDepsForTests({
      store: createMemoryStore(),
      pluggy: null,
      now: () => NOW,
      userEmail: null,
      sendEmail: async () => undefined,
    });
    expect((await handleLogout()).status).toBe(401);
  });
});
