import { describe, expect, it } from "vitest";
import { applyAction, mergeDetections, pruneSuggestions } from "@/lib/actions";
import { buildConfidence, confidenceLabel, CONFIDENCE_WEIGHTS } from "@/lib/confidence";
import { lastChargeLabel } from "@/lib/charges";
import { detect, excludedKind, type CandidateTx } from "@/lib/matching";
import { mapPluggyTransaction } from "@/lib/pluggy/map";
import { buildScreen } from "@/lib/screen";
import { emptyState } from "@/lib/store";
import type { AppState } from "@/lib/types";

const TODAY = "2026-11-01";

function tx(partial: Partial<CandidateTx> & Pick<CandidateTx, "id" | "description" | "chargeDate">): CandidateTx {
  return { amount: 59.9, ...partial };
}

function months(description: string, dates: string[], amount: number | number[] = 59.9, prefix = "t"): CandidateTx[] {
  return dates.map((chargeDate, index) =>
    tx({
      id: `${prefix}-${index}`,
      description,
      chargeDate,
      amount: Array.isArray(amount) ? amount[index] : amount,
    }),
  );
}

const RECENT = ["2026-08-12", "2026-09-12", "2026-10-12"];
const FIVE = ["2026-06-12", "2026-07-12", "2026-08-12", "2026-09-12", "2026-10-12"];

describe("persistence", () => {
  it("suggests 3 or more consecutive recent months", () => {
    const found = detect(months("SUPERGROK", RECENT, 165), [], TODAY);
    expect(found).toHaveLength(1);
    expect(found[0].service).toBe("grok");
    expect(found[0].planName).toBe("SuperGrok");
    expect(found[0].confirm).toBe(false);
    expect(found[0].suggestionLabel).toBe("3 meses seguidos");
    expect(found[0].expectedChargeDate).toBe("2026-10-12");
    const five = detect(months("NETFLIX.COM", FIVE, 59.9), [], TODAY);
    expect(five[0].suggestionLabel).toBe("5 meses seguidos");
    expect(five[0].checks.find((check) => check.id === "streak")?.detail).toBe("5 meses seguidos");
    expect(five[0].checks.find((check) => check.id === "amount")?.detail).toBe("R$ 59,90");
  });

  it("suggests two recent months with a lower streak score than three", () => {
    const two = detect(months("SUPERGROK", ["2026-09-12", "2026-10-12"], 165), [], TODAY);
    expect(two).toHaveLength(1);
    expect(two[0].suggestionLabel).toBe("2 meses seguidos");
    expect(two[0].checks.find((check) => check.id === "streak")?.points).toBe(12);
    const three = detect(months("SUPERGROK", RECENT, 165), [], TODAY);
    expect(three[0].checks.find((check) => check.id === "streak")?.points).toBe(18);
    expect(two[0].confidenceScore).toBeLessThan(three[0].confidenceScore);
  });

  it("suggests an unknown merchant only when it repeats", () => {
    expect(detect(months("ACADEMIA FIT", ["2026-10-09"], 80), [], TODAY)).toEqual([]);
    const twice = detect(months("ACADEMIA FIT", ["2026-09-09", "2026-10-09"], 80), [], TODAY);
    expect(twice).toHaveLength(1);
    expect(twice[0].service).toBe("unknown");
  });

  it("suggests a known service charged once in the last month", () => {
    const once = detect(months("NETFLIX.COM", ["2026-10-20"], 44.9), [], TODAY);
    expect(once).toHaveLength(1);
    expect(once[0].suggestionLabel).toBe("1 cobrança recente");
    expect(once[0].confirm).toBe(false);
    expect(once[0].checked).toBe(false);
    expect(detect(months("NETFLIX.COM", ["2026-08-20"], 44.9), [], TODAY)).toEqual([]);
  });

  it("does not suggest four months that stopped three months ago", () => {
    const stopped = ["2026-03-12", "2026-04-12", "2026-05-12", "2026-06-12"];
    expect(detect(months("NETFLIX.COM", stopped, 44.9), [], TODAY)).toEqual([]);
  });

  it("allows one missed month inside a streak", () => {
    const withGap = ["2026-07-12", "2026-08-12", "2026-10-12"];
    const found = detect(months("CLARO FLEX", withGap, 39.9), [], "2026-10-20");
    expect(found).toHaveLength(1);
    expect(found[0].suggestionLabel).toBe("3 cobranças mensais");
    const twoGaps = detect(months("ACADEMIA FIT", ["2026-06-12", "2026-08-12", "2026-10-12"], 39.9), [], "2026-10-20");
    expect(twoGaps[0].suggestionLabel).toBe("2 cobranças mensais");
    expect(detect(months("ACADEMIA FIT", ["2026-06-12", "2026-09-12"], 39.9), [], "2026-10-20")).toEqual([]);
  });

  it("suggests an annual pair inside thirteen months and skips an old one", () => {
    const found = detect(
      months("MICROSOFT 365", ["2024-11-02", "2025-11-02"], 45),
      [],
      TODAY,
    );
    expect(found).toHaveLength(1);
    expect(found[0].cadence).toBe("annual");
    expect(found[0].suggestionLabel).toBe("2 cobranças anuais");
    expect(detect(months("MICROSOFT 365", ["2023-10-01", "2024-10-01"], 45), [], TODAY)).toEqual([]);
  });
});

describe("noise and generic descriptors", () => {
  const noise: Array<[string, string, Partial<CandidateTx>]> = [
    ["Juros Por Atraso", "juros", {}],
    ["Juros Do Rotativo", "juros", {}],
    ["Multa Por Atraso", "multa", {}],
    ["Pix Recebido Agata Luana Tavares Dos Santos", "pix", {}],
    ["TED Enviado Joao da Silva", "transfer", {}],
    ["Magazine Luiza Parcela 03/10", "installment", {}],
    ["Estorno Netflix", "refund", {}],
    ["IOF do rotativo", "iof", {}],
    ["Pagamento de boleto", "boleto", {}],
    ["Tarifa de manutencao", "fee", {}],
    ["Loja qualquer", "credit", { type: "CREDIT" }],
    ["Agata Luana", "pix", { operationType: "PIX" }],
  ];

  it("excludes every noisy kind even when the amount repeats for six months", () => {
    const dates = ["2026-05-04", "2026-06-04", "2026-07-04", "2026-08-04", "2026-09-04", "2026-10-04"];
    const kinds = new Set<string>();
    for (const [description, kind, extra] of noise) {
      kinds.add(kind);
      expect(excludedKind({ description, amount: extra.amount ?? 20, ...extra }), description).toBe(kind);
      const rows = months(description, dates, 20, kind).map((row) => ({ ...row, ...extra }));
      expect(detect(rows, [], TODAY), description).toEqual([]);
    }
    expect([...kinds]).toEqual(["juros", "multa", "pix", "transfer", "installment", "refund", "iof", "boleto", "fee", "credit"]);
  });

  it("never suggests generic Apple or Google descriptors", () => {
    const dates = ["2026-05-04", "2026-06-04", "2026-07-04", "2026-08-04", "2026-09-04", "2026-10-04"];
    for (const description of ["Assinatura via Apple", "APPLE.COM/BILL", "Google Play", "APPLECOMBILL"]) {
      expect(detect(months(description, dates, 21.9, "g"), [], TODAY), description).toEqual([]);
    }
    const named = detect(months("APPLE ONE", RECENT, 34.9), [], TODAY);
    expect(named.map((item) => item.service)).toEqual(["apple-one"]);
  });
});

describe("amount, day and ranking", () => {
  it("ignores varying consumption and keeps a stable club amount", () => {
    const orders = months("IFOOD PEDIDO", RECENT, [32, 47, 18], "food");
    const club = months("IFOOD *CLUBE", RECENT, 9.9, "club");
    const found = detect([...orders, ...club], [], TODAY);
    expect(found.map((item) => item.planName)).toEqual(["iFood Clube"]);
    expect(found[0].amount).toBe(9.9);
  });

  it("uses the day of the month as a score, not as a gate", () => {
    const netflix = months("NETFLIX.COM", RECENT, 44.9, "n");
    const spotify = months("SPOTIFY", ["2026-08-01", "2026-09-15", "2026-10-28"], 21.9, "s");
    const found = detect([...spotify, ...netflix], [], TODAY);
    expect(found.map((item) => item.planName)).toEqual(["Netflix Padrão", "Spotify Premium"]);
    expect(found[0].confidenceScore).toBeGreaterThan(found[1].confidenceScore);
    expect(found[1].checks.find((check) => check.id === "day")?.passed).toBe(false);
    expect(found[0].checks.find((check) => check.id === "day")?.detail).toBe("sempre perto do dia 12");
  });

  it("ranks a catalog match above an equal unknown streak", () => {
    const known = months("NETFLIX.COM", RECENT, 44.9, "n");
    const unknown = months("ACADEMIA FIT", ["2026-08-03", "2026-09-18", "2026-10-27"], 80, "a");
    const found = detect([...unknown, ...known], [], TODAY);
    expect(found[0].service).toBe("netflix");
    expect(found[0].confidenceScore).toBeGreaterThan(found[1].confidenceScore);
    const screen = buildScreen(mergeDetections(emptyState(), found, true), new Date("2026-11-01T15:00:00.000Z"));
    expect(screen.suggestions.map((item) => item.planName)[0]).toBe("Netflix Padrão");
  });
});

describe("answers stick", () => {
  it("hides only the ignored amount group", () => {
    const pricey = months("ACADEMIA FIT", RECENT, 100, "hi");
    const cheap = months("ACADEMIA FIT", RECENT, 40, "lo");
    const found = detect([...pricey, ...cheap], [], TODAY);
    expect(found).toHaveLength(2);
    const merged = mergeDetections(emptyState(), found, true);
    const expensive = merged.subscriptions.find((item) => item.amount === 100);
    const ignored = applyAction(merged, { action: "ignore", id: expensive!.id }, new Date("2026-11-01T15:00:00.000Z"));
    const again = detect([...pricey, ...cheap], ignored.ignoredDescriptors, TODAY);
    expect(again.map((item) => item.amount)).toEqual([40]);
  });

  it("attaches a later charge to the confirmed plan instead of a new suggestion", () => {
    const first = detect(months("NETFLIX.COM", RECENT, 59.9), [], TODAY);
    const merged = mergeDetections(emptyState(), first, true);
    const confirmed = applyAction(merged, { action: "confirm", id: merged.subscriptions[0].id }, new Date("2026-11-01T15:00:00.000Z"));
    const later = detect(months("NETFLIX.COM", [...RECENT, "2026-11-12"], 59.9), [], "2026-11-20");
    const synced = mergeDetections(confirmed, later, true);
    expect(synced.subscriptions).toHaveLength(1);
    expect(synced.subscriptions[0].status).toBe("confirmed");
    expect(synced.subscriptions[0].expectedChargeDate).toBe("2026-11-12");
    expect(synced.charges.map((charge) => charge.chargeDate)).toContain("2026-11-12");
    const screen = buildScreen(synced, new Date("2026-11-20T15:00:00.000Z"));
    expect(screen.suggestions).toHaveLength(0);
    expect(screen.cards[0].nextChargeLabel).toBe("Última cobrança: 12/11");
  });

  it("prunes stale suggestions and keeps confirmed plans", () => {
    const state: AppState = {
      ...emptyState(),
      subscriptions: [
        {
          id: "keep",
          service: "netflix",
          planName: "Netflix",
          status: "confirmed",
          dismissedAt: null,
          approximate: false,
          merchantKey: "netflix",
          amount: 59.9,
          expectedChargeDate: "2026-10-12",
          checked: false,
          autoConfirmed: false,
          planChangeNotice: null,
          undoStatus: null,
          suppressAutoConfirm: false,
          cancelPromptSnoozeDate: null,
          descriptors: ["NETFLIX COM"],
          suggestionLabel: null,
        },
        {
          id: "drop",
          service: "unknown",
          planName: "Juros Por Atraso",
          status: "suggested",
          dismissedAt: null,
          approximate: false,
          merchantKey: "unknown:JUROS POR ATRASO:16",
          amount: 0.16,
          expectedChargeDate: "2026-08-19",
          checked: false,
          autoConfirmed: false,
          planChangeNotice: null,
          undoStatus: null,
          suppressAutoConfirm: false,
          cancelPromptSnoozeDate: null,
          descriptors: ["JUROS POR ATRASO"],
          suggestionLabel: null,
        },
      ],
    };
    const pruned = pruneSuggestions(state, []);
    expect(pruned.subscriptions.map((item) => item.id)).toEqual(["keep"]);
  });
});

describe("confidence score", () => {
  it("weights recent and streak above the other checks", () => {
    expect(CONFIDENCE_WEIGHTS.recent).toBeGreaterThan(CONFIDENCE_WEIGHTS.amount);
    expect(CONFIDENCE_WEIGHTS.streakCap).toBeGreaterThan(CONFIDENCE_WEIGHTS.catalog);
    const minimum = buildConfidence({
      streakPassed: true,
      occurrences: 3,
      streakDetail: "3 meses seguidos",
      dayPassed: false,
      dayDetail: "dias variados",
      amountPassed: true,
      amountDetail: "R$ 59,90",
      catalogPassed: false,
      catalogDetail: "fora do catálogo",
      recentPassed: true,
      recentDetail: "última em 12/10",
    });
    expect(minimum.score).toBe(63);
    expect(minimum.label).toBe("Média");
    const full = buildConfidence({
      ...{
        streakPassed: true,
        occurrences: 5,
        streakDetail: "5 meses seguidos",
        dayPassed: true,
        dayDetail: "sempre perto do dia 12",
        amountPassed: true,
        amountDetail: "R$ 59,90",
        catalogPassed: true,
        catalogDetail: "Netflix",
        recentPassed: true,
        recentDetail: "última em 12/10",
      },
    });
    expect(full.score).toBe(100);
    expect(full.label).toBe("Alta chance");
    expect(full.checks.map((check) => check.label)).toEqual([
      "Cobrado nos últimos meses",
      "Dias do mês parecidos",
      "Valor estável",
      "Serviço conhecido",
      "Cobrança recente",
    ]);
    expect(confidenceLabel(54)).toBe("Baixa");
    expect(confidenceLabel(55)).toBe("Média");
    expect(confidenceLabel(80)).toBe("Alta chance");
  });
});

describe("last charge label", () => {
  it("shows the last real charge and a stale hint, never a past next charge", () => {
    expect(lastChargeLabel("2026-10-20", TODAY, "monthly")).toBe("Última cobrança: 20/10");
    expect(lastChargeLabel("2026-08-19", TODAY, "monthly")).toBe("Última cobrança: 19/08 · Sem cobrança recente");
    expect(lastChargeLabel("2026-11-19", TODAY, "monthly")).toBe("Sem cobrança recente");
    expect(lastChargeLabel("2026-08-19", TODAY, "monthly")).not.toContain("Próxima cobrança");
  });
});

describe("stored transactions", () => {
  it("does not store credits, pix or interest", () => {
    expect(
      mapPluggyTransaction({ id: "c", description: "Pix Recebido Ana", amount: 250, date: "2026-10-01", type: "CREDIT" }, "item", "acc"),
    ).toBeNull();
    expect(
      mapPluggyTransaction({ id: "j", description: "Juros Por Atraso", amount: 0.16, date: "2026-10-01", type: "DEBIT" }, "item", "acc"),
    ).toBeNull();
    const kept = mapPluggyTransaction(
      { id: "n", description: "NETFLIX.COM", amount: 59.9, date: "2026-10-12", type: "DEBIT", currencyCode: "BRL" },
      "item",
      "acc",
    );
    expect(kept?.description).toBe("NETFLIX.COM");
    expect(kept?.type).toBe("DEBIT");
  });
});
