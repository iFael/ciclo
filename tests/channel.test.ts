import { describe, expect, it } from "vitest";
import { applyAction } from "@/lib/actions";
import { billingChannel, guessAppleService, isGooglePlayBill } from "@/lib/channel";
import { detect, type CandidateTx } from "@/lib/matching";
import { buildScreen } from "@/lib/screen";
import { emptyState } from "@/lib/store";
import type { AppState, Charge, Subscription } from "@/lib/types";

const NOW = new Date("2026-11-01T15:00:00.000Z");

function sub(partial: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    service: "chatgpt",
    planName: "ChatGPT Plus",
    status: "confirmed",
    dismissedAt: null,
    approximate: true,
    merchantKey: "chatgpt",
    amount: 103,
    expectedChargeDate: "2026-10-20",
    checked: false,
    autoConfirmed: false,
    planChangeNotice: null,
    undoStatus: null,
    suppressAutoConfirm: false,
    cancelPromptSnoozeDate: null,
    descriptors: ["OPENAI CHATGPT SUBSCR"],
    suggestionLabel: null,
    ...partial,
  };
}

function charge(subscriptionId: string, chargeDate: string, amount: number): Charge {
  return { subscriptionId, chargeDate, amount, transactionId: `${subscriptionId}-${chargeDate}`, resolved: false };
}

function state(subscriptions: Subscription[], charges: Charge[] = []): AppState {
  return {
    ...emptyState(),
    connections: [
      {
        id: "conn-1",
        itemId: "item",
        institution: "Banco",
        connectorId: "bank",
        status: "active",
        consentExpiresAt: null,
        lastSyncedAt: "2026-11-01T13:00:00.000Z",
        lastErrorCode: null,
        lastSyncHadData: true,
        lastDataThrough: "2026-11-01",
      },
    ],
    subscriptions,
    charges,
  };
}

const appleSuggestion = (partial: Partial<Subscription> = {}) =>
  sub({
    id: "apple-1",
    service: "apple",
    planName: "Assinatura via Apple",
    status: "suggested",
    approximate: false,
    merchantKey: "apple:9990",
    amount: 99.9,
    descriptors: ["APPLE COM BILL"],
    ...partial,
  });

describe("billing channel", () => {
  it("reads the channel from the statement text", () => {
    expect(billingChannel(sub())).toBe("direct");
    expect(billingChannel(sub({ descriptors: ["APPLE COM BILL"] }))).toBe("apple");
    expect(billingChannel(sub({ service: "apple", descriptors: [] }))).toBe("apple");
    expect(billingChannel(sub({ descriptors: ["GOOGLE CHATGPT"] }))).toBe("google-play");
    expect(billingChannel(sub({ service: "youtube", descriptors: ["GOOGLE YOUTUBE PREMIUM"] }))).toBe("direct");
    expect(billingChannel(sub({ service: "google-one", descriptors: ["GOOGLE ONE"] }))).toBe("direct");
  });

  it("recognizes Google Play spellings and leaves Google's own products out", () => {
    expect(isGooglePlayBill("GOOGLE *Duolingo")).toBe(true);
    expect(isGooglePlayBill("GOOGLE PLAY ChatGPT")).toBe(true);
    expect(isGooglePlayBill("GOOGLEPLAY*APP")).toBe(true);
    expect(isGooglePlayBill("GOOGLE *YouTube Premium")).toBe(false);
    expect(isGooglePlayBill("Google One")).toBe(false);
    expect(isGooglePlayBill("OPENAI *CHATGPT")).toBe(false);
  });

  it("names an unknown Google Play app without the store prefix", () => {
    const months = ["2026-08-05", "2026-09-05", "2026-10-05"];
    const txs: CandidateTx[] = months.map((chargeDate, index) => ({ id: `g${index}`, description: "GOOGLE *Duolingo", amount: 29.9, chargeDate }));
    expect(detect(txs, [], "2026-11-01").map((item) => item.planName)).toEqual(["Duolingo"]);
  });
});

describe("manage button", () => {
  it("sends a direct plan to the service's site", () => {
    const model = buildScreen(state([sub()], [charge("sub-1", "2026-10-20", 103)]), NOW);
    expect(model.cards[0].channel).toBe("direct");
    expect(model.cards[0].manageUrl).toBe("https://chatgpt.com/#settings/Subscription");
    expect(model.cards[0].manageButton).toBe("Gerenciar no site");
  });

  it("sends an App Store plan to Apple, even before the service is known", () => {
    const picked = sub({ merchantKey: "apple:9990", amount: 99.9, descriptors: ["APPLE COM BILL"] });
    const model = buildScreen(state([picked], [charge("sub-1", "2026-10-20", 99.9)]), NOW);
    expect(model.cards[0].manageUrl).toBe("https://apps.apple.com/account/subscriptions");
    expect(model.cards[0].manageButton).toBe("Gerenciar na Apple");
    expect(model.cards[0].manageLabel).toBe("Gerenciar ChatGPT Plus na Apple, abre em nova aba");
    expect(model.cards[0].removeConfirm).toBe("Isso não cancela sua assinatura na Apple. Para parar de pagar, use Gerenciar.");

    const unnamed = sub({ service: "apple", planName: "Assinatura via Apple", merchantKey: "apple:1490", amount: 14.9, descriptors: ["APPLE COM BILL"] });
    const second = buildScreen(state([unnamed], [charge("sub-1", "2026-10-20", 14.9)]), NOW);
    expect(second.cards[0].manageUrl).toBe("https://apps.apple.com/account/subscriptions");
  });

  it("sends a Google Play plan to Google Play", () => {
    const play = sub({ descriptors: ["GOOGLE CHATGPT"] });
    const model = buildScreen(state([play], [charge("sub-1", "2026-10-20", 103)]), NOW);
    expect(model.cards[0].manageUrl).toBe("https://play.google.com/store/account/subscriptions");
    expect(model.cards[0].manageButton).toBe("Gerenciar no Google Play");
  });
});

describe("Apple service guess", () => {
  const today = "2026-11-01";

  it("links an Apple charge to a direct plan that stopped when it started", () => {
    const direct = sub({ amount: 103 });
    const apple = appleSuggestion();
    const current = state(
      [direct, apple],
      [charge("sub-1", "2026-08-20", 103), charge("sub-1", "2026-09-20", 103), charge("apple-1", "2026-09-25", 99.9), charge("apple-1", "2026-10-25", 99.9)],
    );
    const guess = guessAppleService(apple, current, today, ["chatgpt", "claude", "grok"]);
    expect(guess).toEqual({
      service: "chatgpt",
      serviceName: "ChatGPT",
      planName: "ChatGPT Plus",
      reason: "Parece ChatGPT Plus: a cobrança direta parou em 20/09 e esta, pela Apple, começou em 25/09.",
      replaces: "sub-1",
    });

    const model = buildScreen(current, NOW);
    expect(model.suggestions[0].appleGuess?.service).toBe("chatgpt");

    const next = applyAction(current, { action: "pick-apple", id: "apple-1", service: "chatgpt", replaces: "sub-1" }, NOW);
    expect(next.subscriptions.find((item) => item.id === "apple-1")).toMatchObject({ status: "confirmed", service: "chatgpt", planName: "ChatGPT Plus", approximate: false });
    expect(next.subscriptions.find((item) => item.id === "sub-1")?.status).toBe("cancelled");
    expect(next.charges.filter((item) => item.subscriptionId === "sub-1")).toHaveLength(2);
  });

  it("does not link a direct plan that is still being charged", () => {
    const direct = sub();
    const apple = appleSuggestion();
    const current = state([direct, apple], [charge("sub-1", "2026-10-20", 103), charge("apple-1", "2026-10-05", 99.9)]);
    const guess = guessAppleService(apple, current, today, ["grok"]);
    expect(guess).toBeNull();
  });

  it("does not cancel a plan of another service", () => {
    const direct = sub({ service: "claude", planName: "Claude Pro", merchantKey: "claude" });
    const current = state([direct, appleSuggestion()]);
    const next = applyAction(current, { action: "pick-apple", id: "apple-1", service: "chatgpt", replaces: "sub-1" }, NOW);
    expect(next.subscriptions.find((item) => item.id === "sub-1")?.status).toBe("confirmed");
  });

  it("guesses by price only when one service fits", () => {
    const grokPrice = appleSuggestion({ amount: 44.9 });
    const current = state([grokPrice], [charge("apple-1", "2026-10-25", 44.9)]);
    // ChatGPT Go and Grok Plus share this price: no guess while both are offered.
    expect(guessAppleService(grokPrice, current, today, ["chatgpt", "claude", "grok"])).toBeNull();
    expect(guessAppleService(grokPrice, current, today, ["claude", "grok"])).toMatchObject({ service: "grok", planName: "Grok Plus", replaces: null });
    // ChatGPT Plus and Claude Pro cost about the same: no guess.
    const shared = appleSuggestion();
    expect(guessAppleService(shared, state([shared], [charge("apple-1", "2026-10-25", 99.9)]), today, ["chatgpt", "claude", "grok"])).toBeNull();
  });
});

describe("manage link chosen by the user", () => {
  it("accepts https links, adds https when missing, refuses the rest and clears on empty", async () => {
    const { cleanManageUrl } = await import("@/lib/actions");
    expect(cleanManageUrl("https://chatgpt.com/settings/billing")).toBe("https://chatgpt.com/settings/billing");
    expect(cleanManageUrl("chatgpt.com/settings/billing")).toBe("https://chatgpt.com/settings/billing");
    expect(cleanManageUrl("  ")).toBeNull();
    expect(cleanManageUrl("http://chatgpt.com")).toBeUndefined();
    expect(cleanManageUrl("javascript:alert(1)")).toBeUndefined();
    expect(cleanManageUrl("https://user:pw@chatgpt.com")).toBeUndefined();
  });

  it("wins over the catalog and the store, and goes back on empty", () => {
    const current = state([sub({ descriptors: ["APPLE COM BILL"] })], [charge("sub-1", "2026-10-20", 99.9)]);
    const custom = applyAction(current, { action: "set-manage-url", id: "sub-1", url: "chatgpt.com/settings/billing" }, NOW);
    const card = buildScreen(custom, NOW).cards[0];
    expect(card.manageUrl).toBe("https://chatgpt.com/settings/billing");
    expect(card.customManageUrl).toBe(true);
    expect(card.manageButton).toBe("Gerenciar no site");

    const refused = applyAction(custom, { action: "set-manage-url", id: "sub-1", url: "javascript:alert(1)" }, NOW);
    expect(refused.subscriptions[0].manageUrl).toBe("https://chatgpt.com/settings/billing");

    const cleared = applyAction(custom, { action: "set-manage-url", id: "sub-1", url: "" }, NOW);
    expect(buildScreen(cleared, NOW).cards[0].manageUrl).toBe("https://apps.apple.com/account/subscriptions");
  });
});

describe("logo from the manage link", () => {
  it("uses the link's site, except store pages and the service's own catalog site", async () => {
    const { logoDomainFromLink } = await import("@/lib/http/plans");
    expect(logoDomainFromLink("https://faculdade.grancursosonline.com.br/minha-conta", "unknown")).toBe("faculdade.grancursosonline.com.br");
    expect(logoDomainFromLink("https://apps.apple.com/account/subscriptions", "chatgpt")).toBeNull();
    expect(logoDomainFromLink("https://play.google.com/store/account/subscriptions", "unknown")).toBeNull();
    expect(logoDomainFromLink("https://chatgpt.com/settings/billing", "chatgpt")).toBeNull();
  });
});
