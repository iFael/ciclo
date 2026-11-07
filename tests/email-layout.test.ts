import { describe, expect, it } from "vitest";
import { renderSummaryHtml } from "@/lib/email-layout";

describe("summary e-mail", () => {
  it("uses the login-code frame, the branded static icon and escapes plan names", () => {
    const html = renderSummaryHtml({
      title: "Seu resumo semanal",
      intro: "Resumo",
      rows: [{ planName: "<b>Plano</b>", priceLabel: "R$ 10,00/mês", nextChargeLabel: "Última cobrança 01/11" }],
      monthlyTotal: 10,
      annualLabel: "≈ R$ 120,00/ano",
    });
    expect(html).toContain("background:#f9f6f0");
    expect(html).toContain("max-width:440px");
    expect(html).toContain("https://ciclo-peach.vercel.app/icons/icon-192.png");
    expect(html).toContain("R$ 10,00");
    expect(html).toContain("1 assinatura ativa");
    expect(html).toContain("&lt;b&gt;Plano&lt;/b&gt;");
    expect(html).not.toContain("<b>Plano</b>");
  });

  it("says so when there is nothing confirmed", () => {
    const html = renderSummaryHtml({ title: "t", intro: "i", rows: [], monthlyTotal: 0, annualLabel: "≈ R$ 0,00/ano" });
    expect(html).toContain("Nenhuma assinatura confirmada.");
  });
});
