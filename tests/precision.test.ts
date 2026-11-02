import { describe, expect, it } from "vitest";
import { detect, isGenericDescriptor, knownMerchants, type CandidateTx } from "@/lib/matching";
import { chargeAmount, mapPluggyTransaction } from "@/lib/pluggy/map";
import { merchantDescriptor, merchantWords } from "@/lib/text";

const TODAY = "2026-11-01";

function months(description: string, dates: string[], amount: number, prefix: string): CandidateTx[] {
  return dates.map((chargeDate, index) => ({ id: `${prefix}-${index}`, description, chargeDate, amount }));
}

describe("intermediaries", () => {
  it("strips the payment intermediary and keeps the merchant", () => {
    expect(merchantWords("MERCADOPAGO*IFOOD")).toEqual(["IFOOD"]);
    expect(merchantWords("MERCADO PAGO *QUERO EDUCACAO")).toEqual(["QUERO", "EDUCACAO"]);
    expect(merchantWords("PAYPAL *GRAN CURSOS")).toEqual(["GRAN", "CURSOS"]);
    expect(merchantWords("MP*GRANFACULDADE")).toEqual(["GRANFACULDADE"]);
    expect(merchantWords("PAYPAL")).toEqual([]);
    expect(merchantDescriptor("EBANX*SPOTIFY")).toBe("SPOTIFY");
  });

  it("treats only a bare intermediary or app store as generic", () => {
    expect(isGenericDescriptor("MERCADOPAGO*IFOOD")).toBe(false);
    expect(isGenericDescriptor("PAYPAL *GRAN CURSOS")).toBe(false);
    expect(isGenericDescriptor("MERCADOPAGO")).toBe(true);
    expect(isGenericDescriptor("MERCADO PAGO")).toBe(true);
    expect(isGenericDescriptor("PAYPAL")).toBe(true);
    expect(isGenericDescriptor("APPLE.COM/BILL")).toBe(true);
    expect(isGenericDescriptor("GOOGLE PLAY")).toBe(true);
  });

  it("suggests a merchant paid through Mercado Pago and names it by the merchant", () => {
    const quero = months("MERCADOPAGO*QUEROEDUCACAO", ["2026-08-05", "2026-09-05", "2026-10-05"], 189.9, "q");
    const found = detect(quero, [], TODAY);
    expect(found).toHaveLength(1);
    expect(found[0].planName).toBe("Queroeducacao");
    expect(found[0].service).toBe("unknown");
    const clube = detect(months("MERCADOPAGO*IFOOD CLUBE", ["2026-09-10", "2026-10-10"], 9.9, "i"), [], TODAY);
    expect(clube[0].service).toBe("ifood-clube");
  });

  it("finds OpenAI and xAI charges without the plan word", () => {
    const openai = detect(months("OPENAI SAN FRANCISCO", ["2026-08-20", "2026-09-20", "2026-10-20"], 110, "o"), [], TODAY);
    expect(openai[0].service).toBe("chatgpt");
    const grok = detect(months("X.AI LLC", ["2026-10-25"], 165, "x"), [], TODAY);
    expect(grok[0].service).toBe("grok");
    expect(grok[0].suggestionLabel).toBe("1 cobrança recente");
  });
});

describe("bank debits and foreign charges", () => {
  const base = { id: "t1", description: "IFOOD CLUBE", date: "2026-10-10", accountId: "acc" };

  it("reads a negative bank DEBIT as a charge and still drops credits", () => {
    expect(chargeAmount({ ...base, amount: -9.9, type: "DEBIT" })).toBe(9.9);
    expect(mapPluggyTransaction({ ...base, amount: -9.9, type: "DEBIT" }, "item", "acc")?.amount).toBe(9.9);
    expect(mapPluggyTransaction({ ...base, amount: 9.9, type: "CREDIT" }, "item", "acc")).toBeNull();
    expect(mapPluggyTransaction({ ...base, amount: -9.9, type: "CREDIT" }, "item", "acc")).toBeNull();
    expect(mapPluggyTransaction({ ...base, description: "Pagamento de fatura", amount: -1200, type: "DEBIT" }, "item", "acc")).toBeNull();
    expect(mapPluggyTransaction({ ...base, description: "Saque 24h", amount: -200, type: "DEBIT" }, "item", "acc")).toBeNull();
  });

  it("uses the converted amount for a foreign charge", () => {
    const usd = { ...base, description: "OPENAI *CHATGPT SUBSCR", amount: 20, currencyCode: "USD", amountInAccountCurrency: 110.4, type: "DEBIT" };
    expect(chargeAmount(usd)).toBe(110.4);
    expect(chargeAmount({ ...usd, amountInAccountCurrency: null })).toBe(20);
  });
});

describe("learned merchants", () => {
  it("recognizes a confirmed merchant from one charge, even through an intermediary and at a new price", () => {
    const known = knownMerchants([
      { status: "confirmed", merchantKey: "unknown:GRAN FACULDADE:18990", service: "unknown", descriptors: ["GRAN FACULDADE"] },
      { status: "ignored", merchantKey: "unknown:UBER:2500", service: "unknown", descriptors: ["UBER"] },
    ]);
    expect(known).toHaveLength(1);
    const once = months("MERCADOPAGO*GRAN FACULDADE", ["2026-10-28"], 209.9, "g");
    expect(detect(once, [], TODAY)).toEqual([]);
    const found = detect(once, [], TODAY, known);
    expect(found).toHaveLength(1);
    expect(found[0].merchantKey).toBe("unknown:GRAN FACULDADE:18990");
    expect(found[0].planName).toBe("Gran Faculdade");
  });
});
