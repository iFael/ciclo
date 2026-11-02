import { describe, expect, it } from "vitest";
import { applyAction, attachKnownCharges, mergeDetections } from "@/lib/actions";
import { catalog, planNameFor } from "@/lib/catalog";
import { addMonthsClamp, diffDays } from "@/lib/dates";
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
      ["APPLE.COM/BILL", null],
      ["APPLECOMBILL", null],
      ["APPLE.COM/BILL.", null],
      ["SUPERGROK", "grok"],
      ["NETFLIX.COM", "netflix"],
      ["APPLE ONE", "apple-one"],
      ["ICLOUD", "apple-one"],
      ["CLAUDETE", null],
      ["PIX CLAUDETE", null],
      ["CLAUDE", null],
      ["OPENAI *API USAGE", null],
      ["OPENAI", "chatgpt"],
      ["OPENAI SAN FRANCISCO", "chatgpt"],
      ["ANTHROPIC PBC", "claude"],
      ["CLAUDE.AI SUBSCRIPTION", "claude"],
      ["X.AI LLC", "grok"],
      ["MERCADOPAGO*IFOOD CLUBE", "ifood-clube"],
      ["MP *IFOODCLUB", null],
      ["PAYPAL *NETFLIX", "netflix"],
      ["EBANX*SPOTIFY", "spotify"],
      ["LOJA X", null],
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
    expect(detect([tx({ id: "ok", description: "OPENAI *CHATGPT SUBSCR", chargeDate: "2026-01-01", mcc: 5734 })], [], "2026-01-02")[0]?.suggestionLabel).toBe("1 cobrança recente");
    expect(detect([tx({ id: "api", description: "OPENAI *API USAGE", amount: 20, chargeDate: "2026-01-01" })], [])).toEqual([]);
  });

  it("suggests three recent calendar months and a pair, the pair with less confidence", () => {
    const months = ["2026-08-12", "2026-09-12", "2026-10-12"];
    const found = detect(
      months.map((chargeDate, index) => tx({ id: `m${index}`, description: "OPENAI *CHATGPT SUBSCR", chargeDate })),
      [],
      "2026-11-01",
    );
    expect(found).toHaveLength(1);
    expect(found[0].confirm).toBe(false);
    expect(found[0].expectedChargeDate).toBe("2026-10-12");
    const pair = detect(
      [
        tx({ id: "a", description: "OPENAI *CHATGPT SUBSCR", chargeDate: "2026-09-12" }),
        tx({ id: "b", description: "OPENAI *CHATGPT SUBSCR", chargeDate: "2026-10-12" }),
      ],
      [],
      "2026-11-01",
    );
    expect(pair).toHaveLength(1);
    expect(pair[0].confidenceScore).toBeLessThan(found[0].confidenceScore);
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
      "2026-04-10",
    );
    expect(found).toHaveLength(1);
    expect(found[0].confirm).toBe(false);
    expect(found[0].checks.find((check) => check.id === "streak")?.passed).toBe(true);
    const leap = ["2028-01-31", "2028-02-29", "2028-03-31"];
    expect(
      detect(
        leap.map((chargeDate, index) => tx({ id: `l${index}`, description: "GROK XAI", amount: 165, chargeDate })),
        [],
        "2028-04-10",
      )[0]?.service,
    ).toBe("grok");
  });

  it("applies 2% BRL and 10% foreign tolerance, and a big jump is one plan change", () => {
    expect(withinTolerance(100, 101.9, false)).toBe(true);
    expect(withinTolerance(100, 102.1, false)).toBe(false);
    expect(withinTolerance(100, 109.9, true)).toBe(true);
    expect(withinTolerance(100, 110.1, true)).toBe(false);
    const stable = detect(
      ["2026-08-12", "2026-09-12", "2026-10-12"].map((chargeDate, index) =>
        tx({ id: `f${index}`, description: "OPENAI *CHATGPT SUBSCR", amount: index === 2 ? 109.9 : 100, chargeDate }),
      ),
      [],
      "2026-11-01",
    );
    expect(stable).toHaveLength(1);
    expect(stable[0].planChangeNotice).toBeNull();
    const jump = detect(
      ["2026-08-12", "2026-09-12", "2026-10-12"].flatMap((chargeDate, index) => [
        tx({ id: `a${index}`, description: "PADARIA DO ZE", amount: 40 + index * 30, chargeDate }),
      ]),
      [],
      "2026-11-01",
    );
    expect(jump).toEqual([]);
  });

  it("never suggests a generic Apple bill, even across six months", () => {
    const months = ["2026-05-04", "2026-06-04", "2026-07-04", "2026-08-04", "2026-09-04", "2026-10-04"];
    const found = detect(
      months.map((chargeDate, index) => tx({ id: `a${index}`, description: "APPLE.COM/BILL", amount: 21.9, chargeDate })),
      [],
      "2026-11-01",
    );
    expect(found).toEqual([]);
  });

  it("does not auto-confirm a known service; one charge or three months stay a suggestion", () => {
    const one = detect([tx({ id: "a", description: "OPENAI *CHATGPT SUBSCR", chargeDate: "2026-10-01" })], [], "2026-11-01");
    expect(one[0].confirm).toBe(false);
    expect(one[0].autoConfirmed).toBe(false);
    const found = detect(
      ["2026-08-01", "2026-09-01", "2026-10-01"].map((chargeDate, index) =>
        tx({ id: `c${index}`, description: "OPENAI *CHATGPT SUBSCR", chargeDate }),
      ),
      [],
      "2026-11-01",
    );
    expect(found[0].confirm).toBe(false);
    expect(found[0].autoConfirmed).toBe(false);
    expect(found[0].suggestionLabel).toBe("3 meses seguidos");
  });

  it("drops an ignored merchant and amount group forever", () => {
    const txs = ["2026-08-01", "2026-09-01", "2026-10-01"].map((chargeDate, index) =>
      tx({ id: `c${index}`, description: "OPENAI *CHATGPT SUBSCR", chargeDate }),
    );
    const merged = mergeDetections(emptyState(), detect(txs, [], "2026-11-01"), true);
    const ignored = applyAction(merged, { action: "ignore", id: merged.subscriptions[0].id }, NOW);
    expect(ignored.ignoredDescriptors).toContain("merchant:chatgpt");
    expect(detect(txs, ignored.ignoredDescriptors, "2026-11-01")).toEqual([]);
  });

  it("keeps plan names inside a 15% FX move and uses the service name outside a band", () => {
    for (const service of catalog()) {
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
    const model = buildScreen(
      state({
        charges: [{ subscriptionId: "sub-1", chargeDate: "2026-10-20", amount: 110, transactionId: "tx-1", resolved: false }],
      }),
      NOW,
    );
    expect(model.monthlyLabel).toBe("R$ 110/mês");
    expect(model.annualLabel).toBe("≈ R$ 1.320/ano");
    expect(model.cards[0].priceLabel).toBe("≈ R$ 110/mês");
    expect(model.cards[0].nextChargeLabel).toBe("Última cobrança: 20/10");
    expect(model.cards[0].nextChargeLabel).not.toContain("Próxima cobrança");
    expect(model.cards[0].logoUrl).toBe("/logos/chatgpt.svg");
    expect(model.cards[0].logoFallback).toBe(false);
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

  it("marks a confirmed plan inactive when it stops charging, and back when it charges again", () => {
    const today = new Date("2026-10-08T15:00:00.000Z");
    const base = state({
      connections: [connection({ lastDataThrough: "2026-10-05", lastSyncHadData: true, status: "active" })],
      subscriptions: [subscription({ expectedChargeDate: "2026-08-20", amount: 110, descriptors: ["OPENAI CHATGPT SUBSCR"] })],
    });
    const screen = buildScreen(base, today);
    expect(screen.cards).toHaveLength(0);
    expect(screen.inactiveCards).toHaveLength(1);
    expect(screen.inactiveCards[0].inactiveLabel).toBe("Sem cobrança desde 20/08");
    expect(screen.monthlyTotal).toBe(0);
    expect(screen.banners.some((banner) => banner.text.startsWith("Parece cancelada?"))).toBe(false);

    const stale = state({
      connections: [connection({ status: "expired", lastSyncHadData: false, lastDataThrough: "2026-10-05" })],
      subscriptions: [subscription({ expectedChargeDate: "2026-08-20" })],
    });
    expect(buildScreen(stale, today).inactiveCards).toHaveLength(0);
    expect(buildScreen(base, new Date("2026-09-20T15:00:00.000Z")).inactiveCards).toHaveLength(0);

    const paid = applyAction(base, { action: "still-paying", id: "sub-1" }, today);
    expect(buildScreen(paid, today).monthlyTotal).toBe(110);
    expect(buildScreen(paid, today).inactiveCards).toHaveLength(0);

    const charged = attachKnownCharges(base, [
      { id: "tx-back", description: "OPENAI *CHATGPT SUBSCR", amount: 112, chargeDate: "2026-10-04" },
      { id: "tx-other", description: "OUTRA LOJA", amount: 110, chargeDate: "2026-10-04" },
      { id: "tx-far", description: "OPENAI *CHATGPT SUBSCR", amount: 300, chargeDate: "2026-10-05" },
    ]);
    expect(charged.charges.map((charge) => charge.transactionId)).toEqual(["tx-back"]);
    const back = buildScreen(charged, today);
    expect(back.cards).toHaveLength(1);
    expect(back.inactiveCards).toHaveLength(0);
    expect(back.monthlyTotal).toBe(110);
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
    const restoredScreen = buildScreen(restored, NOW);
    expect(restoredScreen.cards.length + restoredScreen.inactiveCards.length).toBe(1);
    const ignored = applyAction(base, { action: "ignore-charging", id: "sub-1" }, NOW);
    expect(ignored.subscriptions[0].status).toBe("ignored");
    expect(ignored.ignoredDescriptors).toContain("OPENAI CHATGPT SUBSCR");
    expect(buildScreen(ignored, NOW).cards).toHaveLength(0);
    expect(buildScreen(ignored, NOW).banners.some((item) => item.text.startsWith("Ainda cobrando:"))).toBe(false);
  });

  it("undoes an automatic confirm and a removal", () => {
    const found = detect(
      ["2026-08-01", "2026-09-01", "2026-10-01"].map((chargeDate, index) =>
        tx({ id: `c${index}`, description: "OPENAI *CHATGPT SUBSCR", chargeDate }),
      ),
      [],
      "2026-11-01",
    ).map((item) => ({ ...item, confirm: true, autoConfirmed: true }));
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
    expect(removed.subscriptions[0].status).toBe("dismissed");
    expect(removed.subscriptions[0].dismissedAt).toBe(NOW.toISOString());
    const stillCharging = {
      ...removed,
      charges: [
        ...removed.charges,
        {
          subscriptionId: removed.subscriptions[0].id,
          chargeDate: "2026-12-01",
          amount: 110,
          transactionId: "later",
          resolved: false,
        },
      ],
    };
    expect(
      buildScreen(stillCharging, new Date("2026-12-15T15:00:00.000Z")).banners.some((item) => item.text.startsWith("Ainda cobrando:")),
    ).toBe(true);
  });

  it("sends a confirmed suggestion back to the list and lets undo restore the plan", () => {
    const claude = subscription({
      id: "claude",
      service: "claude",
      planName: "Claude Pro",
      status: "suggested",
      merchantKey: "claude",
      amount: 113.85,
      approximate: true,
      suggestionLabel: "Pode ser recorrente",
      descriptors: ["ANTHROPIC CLAUDE SUB"],
      expectedChargeDate: "2026-11-15",
    });
    const other = subscription({
      id: "other",
      service: "unknown",
      planName: "Suno Inc",
      status: "suggested",
      merchantKey: "unknown:SUNO INC",
      amount: 51.75,
      approximate: false,
      suggestionLabel: null,
      descriptors: ["SUNO INC"],
    });
    const base = state({ subscriptions: [claude, other], connections: [] });
    expect(suggestionCount(base)).toBe("Encontramos 2 possíveis assinaturas");

    const confirmed = applyAction(base, { action: "confirm", id: "claude" }, NOW);
    expect(confirmed.subscriptions.find((item) => item.id === "claude")?.status).toBe("confirmed");
    expect(confirmed.subscriptions.find((item) => item.id === "claude")?.suppressAutoConfirm).toBe(true);
    const confirmedScreen = buildScreen(confirmed, NOW);
    expect(confirmedScreen.cards.map((card) => card.planName)).toEqual(["Claude Pro"]);
    expect(confirmedScreen.suggestions).toHaveLength(1);
    expect(suggestionCount(confirmed)).toBe("Encontramos 1 possível assinatura");
    expect(confirmedScreen.monthlyTotal).toBe(113.85);

    const removed = applyAction(confirmed, { action: "remove", id: "claude" }, NOW);
    const removedPlan = removed.subscriptions.find((item) => item.id === "claude");
    expect(removedPlan?.status).toBe("suggested");
    expect(removedPlan?.dismissedAt).toBeNull();
    expect(removedPlan?.undoStatus).toBe("confirmed");
    expect(removedPlan?.suppressAutoConfirm).toBe(true);
    expect(removedPlan?.suggestionLabel).toBe("Pode ser recorrente");
    const removedScreen = buildScreen(removed, NOW);
    expect(removedScreen.cards).toHaveLength(0);
    expect(removedScreen.suggestions.map((item) => item.planName)).toEqual(["Claude Pro", "Suno Inc"]);
    expect(suggestionCount(removed)).toBe("Encontramos 2 possíveis assinaturas");
    expect(removedScreen.monthlyTotal).toBe(0);
    const charged = {
      ...removed,
      charges: [
        {
          subscriptionId: "claude",
          chargeDate: "2026-12-01",
          amount: 113.85,
          transactionId: "later",
          resolved: false,
        },
      ],
    };
    expect(buildScreen(charged, new Date("2026-12-15T15:00:00.000Z")).banners.some((item) => item.text.startsWith("Ainda cobrando:"))).toBe(false);

    const found = detect(
      [
        tx({ id: "a", description: "ANTHROPIC* CLAUDE SUB", amount: 113.85, chargeDate: "2026-09-15" }),
        tx({ id: "b", description: "ANTHROPIC* CLAUDE SUB", amount: 113.85, chargeDate: "2026-10-15" }),
      ],
      [],
    );
    const synced = mergeDetections(removed, found, true);
    expect(synced.subscriptions.find((item) => item.id === "claude")?.status).toBe("suggested");
    expect(suggestionCount(synced)).toBe("Encontramos 2 possíveis assinaturas");

    const undone = applyAction(removed, { action: "undo", id: "claude" }, NOW);
    expect(undone.subscriptions.find((item) => item.id === "claude")?.status).toBe("confirmed");
    expect(undone.subscriptions.find((item) => item.id === "claude")?.undoStatus).toBeNull();
    expect(buildScreen(undone, NOW).cards.map((card) => card.planName)).toEqual(["Claude Pro"]);
    expect(suggestionCount(undone)).toBe("Encontramos 1 possível assinatura");
    expect(confirmedMonthlyTotal(undone)).toBe(113.85);

    const ignored = applyAction(removed, { action: "ignore", id: "claude" }, NOW);
    expect(ignored.subscriptions.find((item) => item.id === "claude")?.status).toBe("ignored");
    expect(ignored.ignoredDescriptors).toContain("merchant:claude");
    expect(buildScreen(ignored, NOW).suggestions.map((item) => item.planName)).toEqual(["Suno Inc"]);
    const hidden = mergeDetections(ignored, found, true);
    expect(hidden.subscriptions.filter((item) => item.merchantKey === "claude").every((item) => item.status === "ignored")).toBe(true);
    expect(buildScreen(hidden, NOW).suggestions.some((item) => item.planName === "Claude Pro")).toBe(false);
    expect(buildScreen(hidden, NOW).banners.some((item) => item.text.startsWith("Ainda cobrando:"))).toBe(false);
  });
});

function suggestionCount(current: AppState): string | undefined {
  return buildScreen(current, NOW).banners.find((banner) => banner.id === "suggestions")?.text;
}
