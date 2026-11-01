import { describe, expect, it } from "vitest";
import { applyAction, mergeDetections } from "@/lib/actions";
import { CATALOG, planNameFor } from "@/lib/catalog";
import { addDays, addMonthsClamp, diffDays } from "@/lib/dates";
import { createMemoryStore } from "@/lib/memory-store";
import {
  chargeDateOf,
  classifyDescriptor,
  detect,
  normalizeDescriptor,
  withinTolerance,
  type CandidateTx,
} from "@/lib/matching";
import { mapPluggyTransaction } from "@/lib/pluggy/map";
import { planReminders } from "@/lib/reminders";
import { buildScreen, confirmedMonthlyTotal } from "@/lib/screen";
import { syncAll } from "@/lib/sync";
import { emptyState } from "@/lib/store";
import type { AppState, Connection, Subscription } from "@/lib/types";

const NOW = new Date("2026-11-01T15:00:00.000Z");

function tx(partial: Partial<CandidateTx> & Pick<CandidateTx, "id" | "description" | "chargeDate">): CandidateTx {
  return { amount: 110, ...partial };
}

function connection(partial: Partial<Connection> = {}): Connection {
  return {
    id: "conn-1",
    itemId: "item-should-not-leak",
    institution: "Banco teste",
    connectorId: "bank",
    status: "active",
    consentExpiresAt: "2027-06-01T00:00:00.000Z",
    lastSyncedAt: "2026-11-01T13:00:00.000Z",
    lastErrorCode: null,
    lastSyncHadData: true,
    lastDataThrough: "2026-11-01",
    ...partial,
  };
}

function subscription(partial: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
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
    ...partial,
  };
}

function state(partial: Partial<AppState> = {}): AppState {
  return {
    ...emptyState(),
    connections: [connection()],
    subscriptions: [subscription()],
    ...partial,
  };
}

describe("matching", () => {
  it("classifies real descriptors and rejects false positives", () => {
    const table: Array<[string, string | null]> = [
      ["OPENAI *CHATGPT SUBSCR", "chatgpt"],
      ["GROK XAI", "grok"],
      ["ANTHROPIC* CLAUDE SUB", "claude"],
      ["APPLE.COM/BILL", "apple"],
      ["APPLECOMBILL", "apple"],
      ["APPLE.COM/BILL.", "apple"],
      ["CLAUDETE", null],
      ["PIX CLAUDETE", null],
      ["CLAUDE", null],
      ["OPENAI *API USAGE", null],
      ["OPENAI", null],
      ["IOF do rotativo", null],
    ];
    for (const [description, expected] of table) {
      expect(classifyDescriptor(description), description).toBe(expected);
    }
    expect(normalizeDescriptor("OPENAI *CHATGPT SUBSCR")).toBe("OPENAI CHATGPT SUBSCR");
  });

  it("ignores refunds, IOF and MCC-only lines", () => {
    expect(detect([tx({ id: "r", description: "OPENAI *CHATGPT SUBSCR", amount: -110, chargeDate: "2026-01-01" })], [])).toEqual([]);
    expect(detect([tx({ id: "i", description: "IOF do rotativo", amount: 12, chargeDate: "2026-01-01", mcc: 5734 })], [])).toEqual([]);
    expect(detect([tx({ id: "m", description: "LOJA QUALQUER", amount: 50, chargeDate: "2026-01-01", mcc: 5734 })], [])).toEqual([]);
    expect(detect([tx({ id: "ok", description: "OPENAI *CHATGPT SUBSCR", chargeDate: "2026-01-01", mcc: 5734 })], [])).toHaveLength(1);
    expect(detect([tx({ id: "api", description: "OPENAI *API USAGE", amount: 20, chargeDate: "2026-01-01" })], [])).toEqual([]);
  });

  it("treats 28 and 35 day gaps as monthly and 27 and 36 as not", () => {
    const start = "2026-04-01";
    const pair = (days: number) =>
      detect(
        [
          tx({ id: "a", description: "OPENAI *CHATGPT SUBSCR", chargeDate: start }),
          tx({ id: "b", description: "OPENAI *CHATGPT SUBSCR", chargeDate: addDays(start, days) }),
        ],
        [],
      );
    expect(pair(28)[0].confirm).toBe(true);
    expect(pair(35)[0].confirm).toBe(true);
    expect(pair(27)[0].confirm).toBe(false);
    expect(pair(36)[0].confirm).toBe(false);
  });

  it("accepts month-end and leap-year sequences", () => {
    expect(diffDays("2026-01-31", "2026-02-28")).toBe(28);
    expect(diffDays("2026-02-28", "2026-03-31")).toBe(31);
    expect(diffDays("2028-01-31", "2028-02-29")).toBe(29);
    expect(diffDays("2028-02-29", "2028-03-31")).toBe(31);
    expect(addMonthsClamp("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClamp("2028-01-31", 1)).toBe("2028-02-29");
    const chain = ["2026-01-31", "2026-02-28", "2026-03-31"];
    const found = detect(
      chain.map((chargeDate, index) => tx({ id: `c${index}`, description: "ANTHROPIC* CLAUDE SUB", amount: 110, chargeDate })),
      [],
    );
    expect(found).toHaveLength(1);
    expect(found[0].confirm).toBe(true);
    const leap = ["2028-01-31", "2028-02-29", "2028-03-31"];
    expect(
      detect(
        leap.map((chargeDate, index) => tx({ id: `l${index}`, description: "GROK XAI", amount: 165, chargeDate })),
        [],
      )[0].confirm,
    ).toBe(true);
  });

  it("applies 2% BRL and 10% foreign tolerance, and a big jump is one plan change", () => {
    expect(withinTolerance(100, 101.9, false)).toBe(true);
    expect(withinTolerance(100, 102.1, false)).toBe(false);
    expect(withinTolerance(100, 109.9, true)).toBe(true);
    expect(withinTolerance(100, 110.1, true)).toBe(false);
    const foreign = (amount: number) =>
      detect(
        [
          tx({ id: "a", description: "OPENAI *CHATGPT SUBSCR", amount: 100, chargeDate: "2026-01-01" }),
          tx({ id: "b", description: "OPENAI *CHATGPT SUBSCR", amount, chargeDate: "2026-01-31" }),
        ],
        [],
      )[0];
    expect(foreign(109.9).planChangeNotice).toBeNull();
    expect(foreign(110.1).planChangeNotice).toBeTruthy();
    expect(foreign(110.1).confirm).toBe(true);
    const brl = (amount: number) =>
      detect(
        [
          tx({ id: "a", description: "PADARIA DO ZE", amount: 100, chargeDate: "2026-01-01" }),
          tx({ id: "b", description: "PADARIA DO ZE", amount, chargeDate: "2026-01-31" }),
        ],
        [],
      )[0];
    expect(brl(101.9).planChangeNotice).toBeNull();
    expect(brl(102.1).planChangeNotice).toBeTruthy();
    const jump = detect(
      [
        tx({ id: "a", description: "OPENAI *CHATGPT SUBSCR", amount: 110, chargeDate: "2026-01-01" }),
        tx({ id: "b", description: "OPENAI *CHATGPT SUBSCR", amount: 110, chargeDate: "2026-01-31" }),
        tx({ id: "c", description: "OPENAI *CHATGPT SUBSCR", amount: 250, chargeDate: "2026-03-02" }),
      ],
      [],
    );
    expect(jump).toHaveLength(1);
    expect(jump[0].planChangeNotice).toBeTruthy();
    expect(mergeDetections(emptyState(), jump, true).subscriptions).toHaveLength(1);
  });

  it("splits two Apple charges in a month by amount", () => {
    const found = detect(
      [
        tx({ id: "a", description: "APPLE.COM/BILL", amount: 50, chargeDate: "2026-03-05" }),
        tx({ id: "b", description: "APPLECOMBILL", amount: 120, chargeDate: "2026-03-20" }),
      ],
      [],
    );
    expect(found).toHaveLength(2);
    expect(found.every((item) => item.service === "apple" && item.confirm === false)).toBe(true);
    expect(found.map((item) => item.planName)).toEqual(["Assinatura via Apple", "Assinatura via Apple"]);
    expect(new Set(found.map((item) => item.amount))).toEqual(new Set([50, 120]));
  });

  it("counts occurrences for known and unknown merchants", () => {
    const one = detect([tx({ id: "a", description: "OPENAI *CHATGPT SUBSCR", chargeDate: "2026-01-01" })], []);
    expect(one[0].confirm).toBe(false);
    expect(one[0].suggestionLabel).toBe("Pode ser recorrente");
    const two = detect(
      [
        tx({ id: "a", description: "OPENAI *CHATGPT SUBSCR", chargeDate: "2026-01-01" }),
        tx({ id: "b", description: "OPENAI *CHATGPT SUBSCR", chargeDate: "2026-01-31" }),
      ],
      [],
    );
    expect(two[0].confirm).toBe(true);
    expect(two[0].autoConfirmed).toBe(true);
    const unknown = (count: number) =>
      detect(
        Array.from({ length: count }, (_, index) =>
          tx({ id: `u${index}`, description: "PADARIA DO ZE", amount: 40, chargeDate: addDays("2026-01-01", index * 30) }),
        ),
        [],
      )[0];
    expect(unknown(2).checked).toBe(false);
    expect(unknown(2).confirm).toBe(false);
    expect(unknown(3).checked).toBe(true);
    expect(unknown(3).confirm).toBe(false);
  });

  it("drops ignored descriptors forever", () => {
    const txs = [
      tx({ id: "a", description: "OPENAI *CHATGPT SUBSCR", chargeDate: "2026-01-01" }),
      tx({ id: "b", description: "OPENAI *CHATGPT SUBSCR", chargeDate: "2026-01-31" }),
    ];
    const merged = mergeDetections(emptyState(), detect([txs[0]], []), true);
    const ignored = applyAction(merged, { action: "ignore", id: merged.subscriptions[0].id }, NOW);
    expect(detect(txs, ignored.ignoredDescriptors)).toEqual([]);
  });

  it("keeps plan names inside a 15% FX move and uses the service name outside a band", () => {
    for (const service of CATALOG) {
      for (const band of service.plans) {
        expect(planNameFor(service.id, band.referenceBrl * 0.85)).toBe(band.name);
        expect(planNameFor(service.id, band.referenceBrl * 1.15)).toBe(band.name);
      }
    }
    expect(planNameFor("chatgpt", 70)).toBe("ChatGPT");
    expect(planNameFor("chatgpt", 1)).toBe("ChatGPT");
    expect(planNameFor("chatgpt", 10000)).toBe("ChatGPT");
    expect(planNameFor("apple", 50)).toBe("Assinatura via Apple");
  });
});

describe("charge dates", () => {
  it("converts transactionDateTime to America/Sao_Paulo and keeps a bare date", () => {
    expect(chargeDateOf({ date: "2026-07-20T00:00:00.000Z", creditCardMetadata: { transactionDateTime: "2026-07-20T01:30:00Z" } })).toBe("2026-07-19");
    expect(chargeDateOf({ date: "2026-10-15T00:00:00.000Z" })).toBe("2026-10-15");
    const row = mapPluggyTransaction(
      {
        id: "t",
        description: "OPENAI *CHATGPT SUBSCR",
        amount: 10,
        date: "2026-10-15T00:00:00.000Z",
        creditCardMetadata: { payeeMCC: 5734, transactionDateTime: "2026-07-20T01:30:00Z" },
      },
      "item",
      "acc",
    );
    expect(row?.chargeDate).toBe("2026-07-19");
    expect(JSON.stringify(row)).not.toContain("payeeMCC");
    expect(JSON.stringify(row)).not.toContain("creditCard");
  });

  it.skip("22:30 America/Sao_Paulo pending confirmation", () => {
    expect(chargeDateOf({ date: "2026-05-11T00:00:00.000Z", creditCardMetadata: { transactionDateTime: "2026-05-11T01:30:00.000Z" } })).toBe("2026-05-10");
  });

  it.skip("23:59 America/Sao_Paulo pending confirmation", () => {
    expect(chargeDateOf({ date: "2026-05-11T00:00:00.000Z", creditCardMetadata: { transactionDateTime: "2026-05-11T02:59:00.000Z" } })).toBe("2026-05-10");
  });

  it.skip("00:01 America/Sao_Paulo pending confirmation", () => {
    expect(chargeDateOf({ date: "2026-05-10T00:00:00.000Z", creditCardMetadata: { transactionDateTime: "2026-05-10T03:01:00.000Z" } })).toBe("2026-05-10");
  });
});

describe("screen and safety", () => {
  it("builds the card copy and hides server identifiers", () => {
    const model = buildScreen(state(), NOW);
    expect(model.monthlyLabel).toBe("R$ 110/mês");
    expect(model.annualLabel).toBe("≈ R$ 1.320/ano");
    expect(model.cards[0].priceLabel).toBe("≈ R$ 110/mês");
    expect(model.cards[0].nextChargeLabel).toBe("Próxima cobrança: 19/11, em 18 dias");
    expect(model.cards[0].manageLabel).toBe("Gerenciar ChatGPT Plus no site da OpenAI, abre em nova aba");
    expect(model.cards[0].removeConfirm).toBe("Isso não cancela sua assinatura na OpenAI. Para parar de pagar, use Gerenciar.");
    expect(model.footer).toBe("Atualizado há 2 h");
    const encoded = JSON.stringify(model);
    expect(encoded).not.toContain("item-should-not-leak");
    expect(encoded).not.toContain("OPENAI *CHATGPT SUBSCR");
  });

  it("does not cancel, lower the total, or stop reminders on an empty read", async () => {
    const current = state();
    const unchanged = mergeDetections(current, [], false);
    expect(unchanged).toBe(current);
    expect(confirmedMonthlyTotal(unchanged)).toBe(110);
    const store = createMemoryStore(current);
    const calls: string[] = [];
    const result = await syncAll({
      store,
      now: () => NOW,
      seedItemId: "item-seed-should-not-be-used",
      pluggy: {
        async getItem() {
          return { id: "item-should-not-leak", status: "LOGIN_ERROR", connector: { id: "bank", name: "Banco teste" } };
        },
        async getAccounts() {
          calls.push("accounts");
          return [];
        },
        async listTransactions() {
          return [];
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([]);
    const loaded = await store.load();
    expect(loaded.subscriptions[0].status).toBe("confirmed");
    expect(loaded.subscriptions[0].amount).toBe(110);
    expect(confirmedMonthlyTotal(loaded)).toBe(110);
    expect(planReminders({ ...loaded, subscriptions: [{ ...loaded.subscriptions[0], expectedChargeDate: "2026-11-04" }] }, new Set(), NOW).some((mail) => mail.kind === "charge")).toBe(true);
  });

  it("raises Parece cancelada only after a healthy read and answers both ways", () => {
    const today = new Date("2026-10-08T15:00:00.000Z");
    const base = state({
      connections: [connection({ lastDataThrough: "2026-10-05", lastSyncHadData: true, status: "active" })],
      subscriptions: [subscription({ expectedChargeDate: "2026-10-01", amount: 110 })],
    });
    expect(buildScreen(base, today).banners.some((banner) => banner.text.startsWith("Parece cancelada?"))).toBe(true);
    const stale = state({
      connections: [connection({ status: "expired", lastSyncHadData: false, lastDataThrough: "2026-10-05" })],
      subscriptions: [subscription({ expectedChargeDate: "2026-10-01" })],
    });
    expect(buildScreen(stale, today).banners.some((banner) => banner.text.startsWith("Parece cancelada?"))).toBe(false);
    const early = buildScreen(base, new Date("2026-10-07T15:00:00.000Z"));
    expect(early.banners.some((banner) => banner.text.startsWith("Parece cancelada?"))).toBe(false);
    const paid = applyAction(base, { action: "still-paying", id: "sub-1" }, today);
    expect(buildScreen(paid, today).monthlyTotal).toBe(110);
    expect(buildScreen(paid, today).banners.some((banner) => banner.text.startsWith("Parece cancelada?"))).toBe(false);
    const cancelled = applyAction(base, { action: "cancelled", id: "sub-1" }, today);
    expect(confirmedMonthlyTotal(cancelled)).toBe(0);
  });

  it("shows Ainda cobrando after removal and both buttons do what they say", () => {
    const base = state({
      subscriptions: [subscription({ status: "dismissed", dismissedAt: "2026-05-01T12:00:00.000Z", descriptors: ["OPENAI CHATGPT SUBSCR"] })],
      charges: [{ subscriptionId: "sub-1", chargeDate: "2026-06-01", amount: 110, transactionId: "tx-new", resolved: false }],
    });
    const banner = buildScreen(base, NOW).banners.find((item) => item.text.startsWith("Ainda cobrando:"));
    expect(banner?.text).toBe("Ainda cobrando: ChatGPT Plus em 01/06");
    const restored = applyAction(base, { action: "restore-charging", id: "sub-1" }, NOW);
    expect(restored.subscriptions[0].status).toBe("confirmed");
    expect(buildScreen(restored, NOW).cards).toHaveLength(1);
    const ignored = applyAction(base, { action: "ignore-charging", id: "sub-1" }, NOW);
    expect(ignored.subscriptions[0].status).toBe("ignored");
    expect(ignored.ignoredDescriptors).toContain("OPENAI CHATGPT SUBSCR");
    expect(buildScreen(ignored, NOW).cards).toHaveLength(0);
    expect(buildScreen(ignored, NOW).banners.some((item) => item.text.startsWith("Ainda cobrando:"))).toBe(false);
  });

  it("undoes an automatic confirm and a removal", () => {
    const found = detect(
      [
        tx({ id: "a", description: "OPENAI *CHATGPT SUBSCR", chargeDate: "2026-01-01" }),
        tx({ id: "b", description: "OPENAI *CHATGPT SUBSCR", chargeDate: "2026-01-31" }),
      ],
      [],
    );
    const confirmed = mergeDetections(state({ subscriptions: [] }), found, true);
    expect(confirmed.subscriptions[0].status).toBe("confirmed");
    const undone = applyAction(confirmed, { action: "undo", id: confirmed.subscriptions[0].id }, NOW);
    expect(undone.subscriptions[0].status).toBe("suggested");
    const again = mergeDetections(undone, found, true);
    expect(again.subscriptions[0].status).toBe("suggested");
    const removed = applyAction(confirmed, { action: "remove", id: confirmed.subscriptions[0].id }, NOW);
    expect(confirmedMonthlyTotal(removed)).toBe(0);
    const back = applyAction(removed, { action: "undo", id: confirmed.subscriptions[0].id }, NOW);
    expect(back.subscriptions[0].status).toBe("confirmed");
    expect(confirmedMonthlyTotal(back)).toBe(110);
  });
});
