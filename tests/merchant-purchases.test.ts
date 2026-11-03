import { describe, expect, it } from "vitest";
import { attachKnownCharges, mergeDetections } from "@/lib/actions";
import { classifyDescriptor, detect, knownMerchants, type CandidateTx, type Detection } from "@/lib/matching";
import { buildScreen } from "@/lib/screen";
import { emptyState } from "@/lib/store";
import type { Subscription, StoredTx } from "@/lib/types";

const plan: Subscription = {
  id: "clube", service: "ifood-clube", planName: "iFood Clube",
  status: "confirmed", dismissedAt: null, approximate: false,
  merchantKey: "ifood-clube", amount: 7.95, expectedChargeDate: "2026-10-22",
  checked: false, autoConfirmed: false, planChangeNotice: null, undoStatus: null,
  suppressAutoConfirm: false, cancelPromptSnoozeDate: null,
  descriptors: ["IFD*iFood", "IFOOD CLUB"], suggestionLabel: null,
};

const club: StoredTx = {
  id: "club-oct", itemId: "card", accountId: "card", chargeDate: "2026-10-22",
  amount: 7.95, description: "IFD*iFood", type: "DEBIT", operationType: "PAGAMENTO",
  foreignCharge: false,
};

const orders: StoredTx[] = [
  { id: "order-1", chargeDate: "2026-10-30", amount: 61.5 },
  { id: "order-2", chargeDate: "2026-11-01", amount: 53.3 },
].map((tx) => ({
  itemId: "checking", accountId: "checking",
  description: "Pagamento com Pix IFOOD.COM AGENCIA DE RESTAURANTES ONLINE S.A.",
  type: "DEBIT", operationType: "PIX", paymentMethod: "PIX",
  counterpartyKind: "business" as const, foreignCharge: false, ...tx,
}));

const base = {
  ...emptyState(),
  subscriptions: [plan],
  charges: [{ subscriptionId: "clube", transactionId: club.id, chargeDate: club.chargeDate, amount: club.amount, resolved: false }],
};

describe("confirmed subscriptions versus ordinary merchant purchases", () => {
  it("does not label an ordinary iFood purchase as iFood Clube", () => {
    expect(classifyDescriptor("IFOOD CLUBE")).toBe("ifood-clube");
    expect(classifyDescriptor("MERCADOPAGO*IFOOD CLUBE")).toBe("ifood-clube");
    expect(classifyDescriptor("IFD*iFood")).toBeNull();
    expect(classifyDescriptor(orders[1].description)).toBeNull();
    expect(detect(orders as CandidateTx[], [], "2026-11-03")).toEqual([]);
  });

  it("keeps a confirmed Clube amount, date, and charge history when new Pix food orders arrive", () => {
    const rows = [club, ...orders];
    const detected = detect(rows as CandidateTx[], [], "2026-11-03", knownMerchants([plan]));
    const next = mergeDetections(attachKnownCharges(base, rows), detected, true);
    expect(next.subscriptions).toHaveLength(1);
    expect(next.subscriptions[0]).toMatchObject({
      amount: 7.95, expectedChargeDate: "2026-10-22", planChangeNotice: null,
    });
    expect(next.charges.map((charge) => charge.transactionId)).toEqual(["club-oct"]);
    const view = buildScreen(next, new Date("2026-11-03T14:00:00.000Z"));
    expect(view.cards[0].priceLabel).toBe("R$ 7,95/mês");
    expect(view.cards[0].nextChargeLabel).toBe("Última cobrança: 22/10");
  });

  it("rejects an outlier even if a catalog rule produces a detection for an existing plan", () => {
    const falseDetection: Detection = {
      merchantKey: "ifood-clube", service: "ifood-clube", planName: "iFood Clube",
      amount: 53.3, approximate: false, checked: false, autoConfirmed: false,
      confirm: false, planChangeNotice: null, descriptors: [orders[1].description],
      suggestionLabel: "1 cobrança recente", expectedChargeDate: "2026-11-01",
      charges: [{ transactionId: "order-2", chargeDate: "2026-11-01", amount: 53.3 }],
      cadence: "monthly", confidenceScore: 70, confidenceLabel: "Média", checks: [],
    };
    const next = mergeDetections(base, [falseDetection], true);
    expect(next.subscriptions[0]).toEqual(plan);
    expect(next.charges).toEqual(base.charges);
    expect(base.charges).toHaveLength(1);
  });

  it("still updates a confirmed plan for a matching recurring payment within tolerance", () => {
    const normalDetection: Detection = {
      merchantKey: "ifood-clube", service: "ifood-clube", planName: "iFood Clube",
      amount: 8.5, approximate: false, checked: false, autoConfirmed: false,
      confirm: false, planChangeNotice: null, descriptors: ["IFD*iFood"],
      suggestionLabel: "2 cobranças mensais", expectedChargeDate: "2026-11-22",
      charges: [{ transactionId: "club-nov", chargeDate: "2026-11-22", amount: 8.5 }],
      cadence: "monthly", confidenceScore: 75, confidenceLabel: "Média", checks: [],
    };
    const next = mergeDetections(base, [normalDetection], true);
    expect(next.subscriptions[0].amount).toBe(8.5);
    expect(next.charges.map((charge) => charge.transactionId)).toEqual(["club-oct", "club-nov"]);
  });
});
