import { describe, expect, it } from "vitest";
import { detect, knownMerchants } from "@/lib/matching";
import { confirmFromSearch, searchStatement } from "@/lib/search";
import { emptyState } from "@/lib/store";
import type { StoredTx } from "@/lib/types";

function tx(id: string, description: string, chargeDate: string, amount: number): StoredTx {
  return { id, itemId: "item", accountId: "acc", amount, description, chargeDate, foreignCharge: false };
}

const rows: StoredTx[] = [
  tx("i1", "MERCADOPAGO*IFOOD", "2026-03-04", 54.3),
  tx("i2", "MERCADOPAGO*IFOOD", "2026-07-21", 81.1),
  tx("c1", "IFOOD CLUBE", "2026-08-10", 9.9),
  tx("c2", "IFOOD CLUBE", "2026-09-10", 9.9),
  tx("g1", "PAYPAL *GRAN FACULDADE", "2026-01-05", 189.9),
  tx("g2", "PAYPAL *GRAN FACULDADE", "2026-02-05", 189.9),
  tx("p1", "PIX IFOOD REEMBOLSO", "2026-05-01", 30),
];

describe("statement search", () => {
  it("groups hits by merchant across the whole window and skips noise", () => {
    const groups = searchStatement(emptyState(), rows, "ifood");
    expect(groups.map((group) => group.key)).toEqual(["IFOOD CLUBE", "IFOOD"]);
    expect(groups[0]).toMatchObject({ name: "iFood Clube", count: 2, months: 2, amountLabel: "R$ 9,90", lastLabel: "10/09/2026", status: null });
    expect(groups[1]).toMatchObject({ count: 2, amountLabel: "R$ 54,30 a R$ 81,10" });
    expect(searchStatement(emptyState(), rows, "i")).toEqual([]);
    expect(searchStatement(emptyState(), rows, "granfaculdade")[0]?.key).toBe("GRAN FACULDADE");
  });

  it("confirms an old plan from search and then recognizes its next single charge", () => {
    const today = "2026-11-01";
    const state = confirmFromSearch(emptyState(), rows, "GRAN FACULDADE", today);
    expect(state.subscriptions).toHaveLength(1);
    expect(state.subscriptions[0]).toMatchObject({ status: "confirmed", planName: "Gran Faculdade", service: "unknown" });
    expect(state.charges.map((charge) => charge.transactionId).sort()).toEqual(["g1", "g2"]);
    expect(searchStatement(state, rows, "gran")[0].status).toBe("plan");

    const next = [{ id: "g3", description: "MP*GRAN FACULDADE", chargeDate: "2026-10-30", amount: 199.9 }];
    const found = detect(next, state.ignoredDescriptors, today, knownMerchants(state.subscriptions));
    expect(found[0].merchantKey).toBe(state.subscriptions[0].merchantKey);
  });

  it("does nothing for a key with no charges", () => {
    const state = emptyState();
    expect(confirmFromSearch(state, rows, "NADA", "2026-11-01")).toBe(state);
  });
});
