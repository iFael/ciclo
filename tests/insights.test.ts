import { describe, expect, it } from "vitest";
import { spendingHistory } from "@/lib/insights";
import type { AppState } from "@/lib/types";

const base: AppState = { connections: [], ignoredDescriptors: [], subscriptions: [], charges: [] };
const plan = {
  id: "a", service: "chatgpt", planName: "Plano A", status: "confirmed" as const,
  dismissedAt: null, approximate: false, merchantKey: "a", amount: 80,
  expectedChargeDate: null, checked: false, autoConfirmed: false, planChangeNotice: null,
  undoStatus: null, suppressAutoConfirm: false, cancelPromptSnoozeDate: null, descriptors: [], suggestionLabel: null,
};

describe("spending history", () => {
  it("compares only complete consecutive months with recorded charges", () => {
    const state: AppState = {
      ...base, subscriptions: [plan], charges: [
        { subscriptionId: "a", chargeDate: "2026-08-02", amount: 100, transactionId: "aug", resolved: true },
        { subscriptionId: "a", chargeDate: "2026-09-02", amount: 80, transactionId: "sep", resolved: true },
        { subscriptionId: "a", chargeDate: "2026-10-02", amount: 70, transactionId: "oct", resolved: true },
        { subscriptionId: "a", chargeDate: "2026-11-02", amount: 500, transactionId: "nov", resolved: false },
      ],
    };
    expect(spendingHistory(state, "2026-11-06")).toEqual({
      months: [{ month: "2026-08", total: 100 }, { month: "2026-09", total: 80 }, { month: "2026-10", total: 70 }],
      trend: { percent: -13, previous: 80, current: 70 },
    });
  });

  it("does not invent a trend for missing months or incomplete history", () => {
    const state: AppState = {
      ...base, subscriptions: [plan], charges: [
        { subscriptionId: "a", chargeDate: "2026-08-10", amount: 10, transactionId: "1", resolved: true },
        { subscriptionId: "a", chargeDate: "2026-10-10", amount: 15, transactionId: "2", resolved: false },
      ],
    };
    expect(spendingHistory(state, "2026-11-06").trend).toBeNull();
    expect(spendingHistory(base, "2026-11-06").months).toEqual([]);
  });
});
