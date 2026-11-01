import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildScreen } from "@/lib/screen";
import { endAllSessions, safeLog, sessionExpired } from "@/lib/security";
import { emptyState } from "@/lib/store";
import type { Connection, Subscription } from "@/lib/types";

const root = process.cwd();

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return full;
  });
}

describe("security", () => {
  it("expires a session at 30 days and signs out globally", async () => {
    const now = Date.parse("2026-11-01T00:00:00.000Z");
    const day = 24 * 60 * 60 * 1000;
    expect(sessionExpired(now - 30 * day, now)).toBe(true);
    expect(sessionExpired(now - 30 * day + 1, now)).toBe(false);
    let scope = "";
    await endAllSessions({
      auth: {
        signOut: async (args) => {
          scope = args.scope;
        },
      },
    });
    expect(scope).toBe("global");
    const proxy = readFileSync(path.join(root, "proxy.ts"), "utf8");
    expect(proxy).toContain("getUser");
    expect(proxy).toContain("endAllSessions");
    expect(proxy).toContain("sessionExpired");
  });

  it("logs only count, status and error code", () => {
    expect(
      safeLog({
        count: 4,
        status: "active",
        errorCode: "LOGIN_ERROR",
        itemId: "item-should-not-leak",
        clientSecret: "secret",
        description: "OPENAI *CHATGPT SUBSCR",
      }),
    ).toEqual({ count: 4, status: "active", errorCode: "LOGIN_ERROR" });
  });

  it("enables RLS for every app table", () => {
    const sql = readFileSync(path.join(root, "supabase/migrations/20261101120000_ciclo_v1.sql"), "utf8");
    const tables = [...sql.matchAll(/create table public\.(\w+)/gi)].map((match) => match[1]);
    expect(tables).toEqual(
      expect.arrayContaining(["connections", "transactions", "subscriptions", "charges", "ignored_descriptors", "reminders_sent"]),
    );
    for (const table of tables) {
      expect(sql.toLowerCase()).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it("keeps server secrets and item ids out of client source and the screen model", () => {
    const banned = [
      "SUPABASE_SERVICE_ROLE_KEY",
      "PLUGGY_CLIENT_SECRET",
      "PLUGGY_CLIENT_ID",
      "PLUGGY_ITEM_ID",
      "PLUGGY_WEBHOOK_TOKEN",
      "CRON_SECRET",
      "HEALTH_TOKEN",
      "RESEND_API_KEY",
      "ALLOWED_EMAIL",
      "itemId",
      "item_id",
    ];
    const files = walk(path.join(root, "components")).concat(walk(path.join(root, "app"))).filter((file) => readFileSync(file, "utf8").includes("use client"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const word of banned) expect(text, file).not.toContain(word);
    }
    const model = buildScreen(
      {
        ...emptyState(),
        connections: [
          {
            id: "conn",
            itemId: "item-should-not-leak",
            institution: "Banco teste",
            connectorId: "bank",
            status: "active",
            consentExpiresAt: null,
            lastSyncedAt: "2026-11-01T13:00:00.000Z",
            lastErrorCode: null,
            lastSyncHadData: true,
            lastDataThrough: "2026-11-01",
          } satisfies Connection,
        ],
        subscriptions: [
          {
            id: "sub",
            service: "chatgpt",
            planName: "ChatGPT Plus",
            status: "confirmed",
            dismissedAt: null,
            approximate: true,
            merchantKey: "chatgpt",
            amount: 110,
            expectedChargeDate: "2026-11-19",
            checked: false,
            autoConfirmed: false,
            planChangeNotice: null,
            undoStatus: null,
            suppressAutoConfirm: false,
            cancelPromptSnoozeDate: null,
            descriptors: ["OPENAI *CHATGPT SUBSCR"],
            suggestionLabel: null,
          } satisfies Subscription,
        ],
      },
      new Date("2026-11-01T15:00:00.000Z"),
    );
    const encoded = JSON.stringify(model);
    expect(encoded).not.toContain("item-should-not-leak");
    expect(encoded).not.toContain("OPENAI *CHATGPT SUBSCR");
    expect(encoded).not.toContain("creditCardMetadata");
  });
});
