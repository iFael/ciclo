import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setDepsForTests, type AppDeps } from "@/lib/deps";
import { handleManualSync } from "@/lib/http/sync";
import { createMemoryStore } from "@/lib/memory-store";
import { planReminders } from "@/lib/reminders";
import {
  countNewSuggestions,
  FOREGROUND_AWAY_MS,
  rateLimitMessage,
  retryAfterSeconds,
  shouldStartAutoSync,
  suggestionSummary,
  SYNC_COOLDOWN_MS,
} from "@/lib/sync-policy";
import type { PluggySource } from "@/lib/pluggy/client";
import type { Connection, Subscription } from "@/lib/types";

const NOW = new Date("2026-11-01T15:00:00.000Z");
const SECRET = "cron-secret-should-not-leak";

function connection(lastSyncedAt: string | null): Connection {
  return {
    id: "conn-1",
    itemId: "item-should-not-leak",
    institution: "Banco teste",
    connectorId: "bank",
    status: "active",
    consentExpiresAt: "2027-06-01T00:00:00.000Z",
    lastSyncedAt,
    lastErrorCode: null,
    lastSyncHadData: true,
    lastDataThrough: "2026-10-12",
  };
}

function subscription(): Subscription {
  return {
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
  };
}

function pluggy(): PluggySource & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async getItem(id) {
      calls.push(id);
      return {
        id,
        status: "UPDATED",
        connector: { id: "bank", name: "Banco teste" },
        consentExpiresAt: "2027-06-01T00:00:00.000Z",
      };
    },
    async getAccounts() {
      return [{ id: "acc", type: "CREDIT" }];
    },
    async listTransactions() {
      return [
        { id: "n1", description: "NETFLIX.COM", amount: 44.9, date: "2026-08-12T12:00:00.000Z", accountId: "acc", currencyCode: "BRL" },
        { id: "n2", description: "NETFLIX.COM", amount: 44.9, date: "2026-09-12T12:00:00.000Z", accountId: "acc", currencyCode: "BRL" },
        { id: "n3", description: "NETFLIX.COM", amount: 44.9, date: "2026-10-12T12:00:00.000Z", accountId: "acc", currencyCode: "BRL" },
      ];
    },
  };
}

function useDeps(store = createMemoryStore(), source: PluggySource | null = pluggy(), userEmail: string | null = "owner@example.com") {
  const mail: string[] = [];
  const value: AppDeps & { mail: string[] } = {
    store,
    pluggy: source,
    now: () => NOW,
    userEmail,
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
});

function request() {
  return new Request("http://localhost/api/sync", {
    method: "POST",
    headers: { authorization: `Bearer ${SECRET}` },
  });
}

describe("manual sync auth, throttle and reminders", () => {
  it("returns 401 when logged out and ignores the cron secret", async () => {
    process.env.CRON_SECRET = SECRET;
    const source = pluggy();
    const runtime = useDeps(createMemoryStore({ connections: [connection(null)] }), source, null);
    const response = await handleManualSync(request());
    const raw = await response.text();
    expect(response.status).toBe(401);
    expect(JSON.parse(raw)).toEqual({ error: "unauthorized" });
    expect(source.calls).toEqual([]);
    expect(runtime.mail).toEqual([]);
    expect(raw).not.toContain(SECRET);
  });

  it("refuses a second sync inside two minutes and tells how long to wait", async () => {
    const source = pluggy();
    useDeps(createMemoryStore({ connections: [connection(new Date(NOW.getTime() - 30_000).toISOString())] }), source);
    const response = await handleManualSync(request());
    const body = (await response.json()) as { error: string; retryAfterSeconds: number };
    expect(response.status).toBe(429);
    expect(body.retryAfterSeconds).toBe(90);
    expect(body.error).toBe(rateLimitMessage(90));
    expect(body.error).toContain("1 min 30 s");
    expect(source.calls).toEqual([]);
    expect(response.headers.get("retry-after")).toBe("90");
  });

  it("syncs with the same Pluggy read and does not send reminder emails", async () => {
    process.env.CRON_SECRET = SECRET;
    const source = pluggy();
    const store = createMemoryStore({
      connections: [connection("2026-07-01T00:00:00.000Z")],
      subscriptions: [subscription()],
    });
    const runtime = useDeps(store, source);
    const response = await handleManualSync(request());
    const body = (await response.json()) as { ok: boolean; newSuggestions: number; message: string };
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.newSuggestions).toBe(1);
    expect(body.message).toBe("1 nova sugestão");
    expect(source.calls).toEqual(["item-should-not-leak"]);
    expect(planReminders(await store.load(), new Set(), NOW).length).toBeGreaterThan(0);
    expect(runtime.mail).toEqual([]);
    const encoded = JSON.stringify(body);
    expect(encoded).not.toContain(SECRET);
    expect(encoded).not.toContain("item-should-not-leak");
    expect(encoded).not.toContain("OPENAI *CHATGPT SUBSCR");

    const again = await handleManualSync(request());
    expect(again.status).toBe(429);
    expect(source.calls).toEqual(["item-should-not-leak"]);
    expect(runtime.mail).toEqual([]);
  });

  it("does not mention the cron secret or the reminder sender", () => {
    const handler = readFileSync(path.join(process.cwd(), "lib/http/sync.ts"), "utf8");
    const route = readFileSync(path.join(process.cwd(), "app/api/sync/route.ts"), "utf8");
    expect(handler).not.toContain("CRON_SECRET");
    expect(handler).not.toContain("deliverReminders");
    expect(route).not.toContain("CRON_SECRET");
    expect(route).not.toContain("deliverReminders");
  });
});

describe("auto sync policy", () => {
  const now = Date.parse("2026-11-02T15:00:00.000Z");

  it("runs on open when the last sync is older than the cooldown", () => {
    expect(
      shouldStartAutoSync({
        inFlight: false,
        lastSyncedAt: new Date(now - SYNC_COOLDOWN_MS - 1).toISOString(),
        now,
        reason: "load",
      }),
    ).toBe(true);
    expect(retryAfterSeconds(null, new Date(now))).toBe(0);
  });

  it("skips when the last sync was less than two minutes ago", () => {
    const last = new Date(now - 30_000).toISOString();
    expect(shouldStartAutoSync({ inFlight: false, lastSyncedAt: last, now, reason: "load" })).toBe(false);
    expect(shouldStartAutoSync({ inFlight: false, lastSyncedAt: last, now, reason: "foreground", hiddenForMs: 10 * 60 * 1000 })).toBe(false);
    expect(retryAfterSeconds(last, new Date(now))).toBe(90);
  });

  it("runs when the app returns after being hidden, once the cooldown has passed", () => {
    const last = new Date(now - 10 * 60 * 1000).toISOString();
    expect(shouldStartAutoSync({ inFlight: false, lastSyncedAt: last, now, reason: "foreground", hiddenForMs: FOREGROUND_AWAY_MS - 1 })).toBe(false);
    expect(shouldStartAutoSync({ inFlight: false, lastSyncedAt: last, now, reason: "foreground", hiddenForMs: FOREGROUND_AWAY_MS })).toBe(true);
  });

  it("does not start a second sync while one is in flight", () => {
    const last = new Date(now - 10 * 60 * 1000).toISOString();
    expect(shouldStartAutoSync({ inFlight: true, lastSyncedAt: last, now, reason: "load" })).toBe(false);
    expect(shouldStartAutoSync({ inFlight: true, lastSyncedAt: last, now, reason: "foreground", hiddenForMs: 10 * 60 * 1000 })).toBe(false);
  });

  it("phrases the wait and the suggestion count", () => {
    expect(suggestionSummary(0)).toBe("Nada novo");
    expect(suggestionSummary(1)).toBe("1 nova sugestão");
    expect(suggestionSummary(3)).toBe("3 novas sugestões");
    expect(rateLimitMessage(45)).toBe("Você pode sincronizar de novo em 45 s.");
    expect(rateLimitMessage(120)).toBe("Você pode sincronizar de novo em 2 minutos.");
    expect(countNewSuggestions(["a"], ["a", "b", "c"])).toBe(2);
    expect(retryAfterSeconds(new Date(now - SYNC_COOLDOWN_MS).toISOString(), new Date(now))).toBe(0);
  });
});
