import { describe, expect, it } from "vitest";
import { applyAction, mergeDetections } from "@/lib/actions";
import { feedbackFrom, keyWords, learnedAdjustment, LEARNED_BOOST, LEARNED_PENALTY } from "@/lib/learning";
import { detect, excludedKind, type CandidateTx } from "@/lib/matching";
import { buildScreen } from "@/lib/screen";
import { emptyState } from "@/lib/store";
import type { AppState } from "@/lib/types";

const TODAY = "2026-11-01";
const NOW = new Date("2026-11-01T15:00:00.000Z");

function months(description: string, dates: string[], amount: number, prefix: string): CandidateTx[] {
  return dates.map((chargeDate, index) => ({ id: `${prefix}-${index}`, description, chargeDate, amount }));
}

describe("noise", () => {
  it("drops amounts under R$ 1 and investment or reserve movements", () => {
    const base = { amount: 50, description: "LOJA" };
    expect(excludedKind({ ...base, amount: 0.01, description: "RENDIMENTOS" })).toBe("tiny");
    expect(excludedKind({ ...base, amount: 0.99 })).toBe("tiny");
    expect(excludedKind({ ...base, description: "Dinheiro Retirado Reserva", amount: 100 })).toBe("investment");
    expect(excludedKind({ ...base, description: "Rendimentos" })).toBe("investment");
    expect(excludedKind({ ...base, description: "APLICACAO CDB" })).toBe("investment");
    expect(excludedKind({ ...base, description: "Resgate Poupança" })).toBe("investment");
    expect(excludedKind({ ...base, description: "Compra", category: "Investments" })).toBe("investment");
    expect(excludedKind({ ...base, description: "NETFLIX.COM", amount: 1 })).toBeNull();
    const reserve = months("Dinheiro Retirado Reserva", ["2026-08-05", "2026-09-05", "2026-10-05"], 100, "r");
    expect(detect(reserve, [], TODAY)).toEqual([]);
  });
});

describe("learning from choices", () => {
  it("keeps distinctive words only", () => {
    expect(keyWords("PAG*ACADEMIA FIT LTDA SAO PAULO 123")).toEqual(["ACADEMIA", "FIT"]);
  });

  it("boosts what looks like a confirmed plan and demotes what looks like a refused one", () => {
    const state: AppState = emptyState();
    const feedback = feedbackFrom({
      ...state,
      subscriptions: [
        {
          id: "a",
          service: "unknown",
          planName: "Academia Fit",
          status: "confirmed",
          dismissedAt: null,
          approximate: false,
          merchantKey: "unknown:ACADEMIA FIT:8000",
          amount: 80,
          expectedChargeDate: "2026-10-09",
          checked: false,
          autoConfirmed: false,
          planChangeNotice: null,
          undoStatus: null,
          suppressAutoConfirm: false,
          cancelPromptSnoozeDate: null,
          descriptors: ["ACADEMIA FIT"],
          suggestionLabel: null,
        },
      ],
      ignoredDescriptors: ["UBER TRIP", "merchant:ifood"],
    });
    expect(learnedAdjustment(["ACADEMIA FIT UNIDADE 2"], feedback)).toEqual({ points: LEARNED_BOOST, detail: "parecido com o que você confirmou" });
    expect(learnedAdjustment(["UBER *TRIP HELP"], feedback)).toEqual({ points: LEARNED_PENALTY, detail: "parecido com o que você recusou" });
    expect(learnedAdjustment(["NETFLIX COM"], feedback)).toBeNull();
  });

  it("reorders suggestions on screen after the user confirms and refuses", () => {
    const txs = [
      ...months("ACADEMIA FIT", ["2026-08-09", "2026-09-09", "2026-10-09"], 80, "a"),
      ...months("ACADEMIA FIT UNIDADE 2", ["2026-09-15", "2026-10-15"], 60, "b"),
      ...months("UBER TRIP", ["2026-09-03", "2026-10-03"], 25, "u"),
      ...months("UBER EATS", ["2026-09-04", "2026-10-04"], 40, "e"),
    ];
    let state = mergeDetections(emptyState(), detect(txs, [], TODAY), true);
    const byName = (name: string) => state.subscriptions.find((item) => item.descriptors.includes(name));
    const before = buildScreen(state, NOW).suggestions;
    const score = (list: typeof before, id: string | undefined) => list.find((item) => item.id === id)?.confidence.score ?? -1;
    const unit = byName("ACADEMIA FIT UNIDADE 2")?.id;
    const eats = byName("UBER EATS")?.id;
    const unitBefore = score(before, unit);
    const eatsBefore = score(before, eats);

    state = applyAction(state, { action: "confirm", id: byName("ACADEMIA FIT")!.id }, NOW);
    state = applyAction(state, { action: "ignore", id: byName("UBER TRIP")!.id }, NOW);
    const after = buildScreen(state, NOW).suggestions;
    expect(score(after, unit)).toBe(Math.min(100, unitBefore + LEARNED_BOOST));
    expect(score(after, eats)).toBe(Math.max(0, eatsBefore + LEARNED_PENALTY));
    expect(after[0].id).toBe(unit);
    expect(after.find((item) => item.id === unit)?.confidence.checks.at(-1)?.detail).toBe("parecido com o que você confirmou");
  });
});
