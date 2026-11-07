import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDepsForTests } from "@/lib/deps";
import { handleSummaryEmail, resetSummaryCooldownForTests } from "@/lib/http/summary-email";
import { createMemoryStore } from "@/lib/memory-store";

const NOW = new Date("2026-11-02T15:00:00.000Z");

function useDeps(userEmail: string | null = "owner@example.com", fail = false) {
  const store = createMemoryStore();
  const sent: { subject: string; html?: string }[] = [];
  let now = NOW;
  setDepsForTests({
    store,
    pluggy: null,
    now: () => now,
    userEmail,
    sendEmail: async (message) => {
      if (fail) throw new Error("boom");
      sent.push(message);
    },
  });
  return { store, sent, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

describe("send summary by e-mail", () => {
  beforeEach(() => resetSummaryCooldownForTests());
  afterEach(() => setDepsForTests(null));

  it("needs a session", async () => {
    const runtime = useDeps(null);
    expect((await handleSummaryEmail()).status).toBe(401);
    expect(runtime.sent).toHaveLength(0);
  });

  it("sends the weekly summary in the e-mail layout without using up this week's automatic one", async () => {
    const runtime = useDeps();
    const response = await handleSummaryEmail();
    expect(response.status).toBe(200);
    expect(runtime.sent).toHaveLength(1);
    expect(runtime.sent[0].subject).toBe("Recontei — resumo semanal");
    expect(runtime.sent[0].html).toContain("Seu resumo semanal");
    expect(await runtime.store.sentReminderKeys()).toEqual([]);
  });

  it("waits a minute between sends", async () => {
    const runtime = useDeps();
    await handleSummaryEmail();
    expect((await handleSummaryEmail()).status).toBe(429);
    runtime.advance(61_000);
    expect((await handleSummaryEmail()).status).toBe(200);
    expect(runtime.sent).toHaveLength(2);
  });

  it("reports a failed send", async () => {
    useDeps("owner@example.com", true);
    const response = await handleSummaryEmail();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Não foi possível enviar o e-mail agora." });
  });
});
