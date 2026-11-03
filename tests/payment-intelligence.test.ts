import { describe, expect, it } from "vitest";
import { attachKnownCharges } from "@/lib/actions";
import { transactionQueries } from "@/lib/dates";
import { detect } from "@/lib/matching";
import { isSubscriptionCandidate, paymentKey } from "@/lib/payment-identity";
import { mapPluggyTransaction } from "@/lib/pluggy/map";
import { createMemoryStore } from "@/lib/memory-store";
import { syncAll } from "@/lib/sync";
import { linkPaymentsToPlan, searchStatement } from "@/lib/search";
import { emptyState } from "@/lib/store";
import type { StoredTx, Subscription } from "@/lib/types";

const plan: Subscription = {
  id: "chatgpt", service: "chatgpt", planName: "ChatGPT Plus", status: "confirmed",
  dismissedAt: null, approximate: true, merchantKey: "chatgpt", amount: 103,
  expectedChargeDate: "2026-07-19", checked: false, autoConfirmed: false,
  planChangeNotice: null, undoStatus: null, suppressAutoConfirm: false,
  cancelPromptSnoozeDate: null, descriptors: ["OPENAI CHATGPT SUBSCR"], suggestionLabel: null,
};

function pix(id: string, description: string, date: string, accountId = "mercado-pago", amount = 103.4): StoredTx {
  return { id, itemId: "mp", accountId, description, chargeDate: date, amount, type: "DEBIT", status: "POSTED", operationType: "PIX", paymentMethod: "PIX", foreignCharge: false };
}

const history = [
  pix("a", "Pagamento com QR Pix EBANX Ltda.", "2026-08-16"),
  pix("b", "Pix automático Ebanx", "2026-09-20"),
  pix("c", "Pix automático Ebanx", "2026-10-19"),
];

describe("transaction intelligence", () => {
  it("retains outgoing and incoming transactions with source evidence but no sensitive payment documents", () => {
    const raw = {
      id: "raw", description: "Pagamento com QR Pix EBANX Ltda.", descriptionRaw: "PIX QR EBANX",
      amount: -103.4, date: "2026-10-19", type: "DEBIT", status: "POSTED",
      paymentData: { paymentMethod: "PIX", receiver: { name: "EBANX Ltda.", documentNumber: { type: "CNPJ", value: "12345678000100" } } },
    };
    const mapped = mapPluggyTransaction(raw, "item", "account")!;
    expect(mapped).toMatchObject({
      amount: 103.4, originalAmount: -103.4, type: "DEBIT", status: "POSTED",
      descriptionRaw: "PIX QR EBANX", paymentMethod: "PIX", counterpartyName: "EBANX Ltda.",
      counterpartyKind: "business",
    });
    expect(JSON.stringify(mapped)).not.toContain("12345678000100");
    expect(mapPluggyTransaction({ ...raw, type: "CREDIT", amount: 103.4 }, "item", "account")?.type).toBe("CREDIT");
    expect(isSubscriptionCandidate({ ...mapped, type: "CREDIT" })).toBe(false);
  });

  it("recognizes description variants as one payee but never assumes that payee is OpenAI", () => {
    expect(paymentKey(history[0])).toBe("EBANX");
    expect(history.map(paymentKey)).toEqual(["EBANX", "EBANX", "EBANX"]);
    expect(searchStatement(emptyState(), history, "ebanx").map((group) => [group.key, group.count]))
      .toEqual([["payee:EBANX", 3]]);
    const suggestions = detect(history, [], "2026-11-02");
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].service).toBe("unknown");
    expect(suggestions[0].planName).toBe("Ebanx");
    expect(isSubscriptionCandidate(pix("personal", "Pix enviado Maria", "2026-10-19"))).toBe(false);
  });

  it("links only selected paid transactions and learns after two confirmed months", () => {
    const before = { ...emptyState(), subscriptions: [plan] };
    const one = linkPaymentsToPlan(before, history, "chatgpt", ["a"], "payee:EBANX");
    expect(one.charges.map((charge) => charge.transactionId)).toEqual(["a"]);
    expect(one.subscriptions[0].paymentMatches).toBeUndefined();
    const linked = linkPaymentsToPlan(one, history, "chatgpt", ["b", "c"], "payee:EBANX");
    expect(linked.charges.map((charge) => charge.transactionId)).toEqual(["a", "b", "c"]);
    expect(linked.subscriptions[0].expectedChargeDate).toBe("2026-10-19");
    expect(linked.subscriptions[0].paymentMatches).toEqual([{ key: "EBANX", accountId: "mercado-pago", amount: 103.4 }]);
    expect(linkPaymentsToPlan(linked, history, "chatgpt", ["a"], "payee:EBANX")).toBe(linked);
    expect(linkPaymentsToPlan(before, history, "chatgpt", ["a"], "payee:WRONG")).toBe(before);

    const next = pix("d", "Pix automático Ebanx", "2026-11-19");
    const unrelated = pix("other-account", "Pix automático Ebanx", "2026-11-20", "different-account");
    const expensive = pix("other-service", "Pix automático Ebanx", "2026-11-21", "mercado-pago", 300);
    const incoming = { ...pix("incoming", "Pix automático Ebanx", "2026-11-22"), type: "CREDIT" };
    const pending = { ...pix("pending", "Pix automático Ebanx", "2026-11-23"), status: "PENDING" };
    const following = attachKnownCharges(linked, [next, unrelated, expensive, incoming, pending]);
    expect(following.charges.map((charge) => charge.transactionId)).toEqual(["a", "b", "c", "d"]);
  });

  it("forces one full historical reread after the import contract upgrade", () => {
    const old = transactionQueries({ accountId: "acc", lastSyncedAt: "2026-11-03T12:00:00Z", today: "2026-11-03", importVersion: 1 });
    expect(old).toEqual([{ accountId: "acc", dateFrom: "2025-09-03" }]);
    const current = transactionQueries({ accountId: "acc", lastSyncedAt: "2026-11-03T12:00:00Z", today: "2026-11-03", importVersion: 2 });
    expect(current).toHaveLength(2);
  });
  it("replays full bank history once and never duplicates a known Pix subscription", async () => {
    const store = createMemoryStore({
      connections: [{
        id: "conn", itemId: "mp", institution: "Mercado Pago", connectorId: "mp",
        status: "active", consentExpiresAt: null, lastSyncedAt: "2026-11-02T12:00:00Z",
        lastErrorCode: null, lastSyncHadData: true, lastDataThrough: "2026-10-19", importVersion: 1,
      }],
      subscriptions: [{ ...plan, paymentMatches: [{ key: "EBANX", accountId: "mercado-pago", amount: 103.4 }] }],
      charges: history.map((tx) => ({ subscriptionId: "chatgpt", chargeDate: tx.chargeDate, amount: tx.amount, transactionId: tx.id, resolved: false })),
      transactions: history,
    });
    const queries: Array<{ dateFrom?: string; createdAtFrom?: string }> = [];
    const result = await syncAll({
      store, now: () => new Date("2026-11-23T15:00:00Z"),
      pluggy: {
        async getItem(id) { return { id, status: "UPDATED" }; },
        async getAccounts() { return [{ id: "mercado-pago", type: "BANK" }]; },
        async listTransactions(query) {
          queries.push(query);
          return [...history, pix("nov", "Pix automático Ebanx", "2026-11-19")]
            .map((tx) => ({ id: tx.id, description: tx.description, date: tx.chargeDate,
              amount: -tx.amount, type: "DEBIT", status: "POSTED", operationType: "PIX", accountId: tx.accountId }));
        },
      },
    });
    expect(result.ok).toBe(true);
    expect(queries).toEqual([{ accountId: "mercado-pago", dateFrom: "2025-09-23" }]);
    const state = await store.load();
    expect(state.connections[0].importVersion).toBe(2);
    expect(state.charges.map((charge) => charge.transactionId).sort()).toEqual(["a", "b", "c", "nov"]);
    expect(state.subscriptions).toHaveLength(1);
  });

});
