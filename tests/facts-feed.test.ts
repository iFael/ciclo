import { describe, expect, it } from "vitest";
import { factsFeedTransactions, normalizeBankText } from "@/lib/facts-feed";
import type { StoredTx } from "@/lib/types";

function tx(overrides: Partial<StoredTx>): StoredTx {
  return {
    id: "tx",
    itemId: "item",
    accountId: "account",
    amount: 800,
    description: "Pix enviado Agata Luana Tavares dos Santos",
    chargeDate: "2026-11-05",
    foreignCharge: false,
    type: "DEBIT",
    status: "POSTED",
    operationType: "PIX",
    ...overrides,
  };
}

describe("Facts bank feed", () => {
  it("normalizes accents, case and punctuation", () => {
    expect(normalizeBankText("  ÁGATA  Luana-Tavares dos Santos ")).toBe("agata luana tavares dos santos");
  });

  it("returns outgoing posted transfers to the requested recipient", () => {
    const rows = [
      tx({ id: "outgoing" }),
      tx({ id: "incoming", type: "CREDIT", amount: 250, description: "Pix recebido AGATA LUANA TAVARES DOS SANTOS" }),
      tx({ id: "other", description: "Pix enviado Outra Pessoa" }),
      tx({ id: "pending", status: "PENDING" }),
    ];
    expect(factsFeedTransactions(rows, "Agata Luana Tavares dos Santos").map((row) => row.id)).toEqual(["outgoing"]);
  });

  it("matches the description when Pluggy does not populate receiver.name", () => {
    const rows = [tx({ counterpartyName: null, descriptionRaw: "PIX ENVIADO AGATA LUANA TAVARES DOS SANTOS" })];
    expect(factsFeedTransactions(rows, "Agata Luana Tavares dos Santos")).toHaveLength(1);
  });
});
