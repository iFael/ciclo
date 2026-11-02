import { expect, test } from "@playwright/test";

const checks = (passed: boolean[], details: string[]) =>
  [
    ["streak", "Cobrado nos últimos meses"],
    ["day", "Dias do mês parecidos"],
    ["amount", "Valor estável"],
    ["catalog", "Serviço conhecido"],
    ["recent", "Cobrança recente"],
  ].map(([id, label], index) => ({ id, label, detail: details[index], passed: passed[index] }));

function suggestion(partial: {
  id: string;
  planName: string;
  priceLabel: string;
  score: number;
  label: string;
  logoUrl: string | null;
  logoFallback: boolean;
  passed: boolean[];
  details: string[];
}) {
  return {
    id: partial.id,
    planName: partial.planName,
    label: null,
    checked: false,
    priceLabel: partial.priceLabel,
    apple: false,
    logoUrl: partial.logoUrl,
    logoFallback: partial.logoFallback,
    confidence: { score: partial.score, label: partial.label, checks: checks(partial.passed, partial.details) },
  };
}

const payload = {
  monthlyLabel: "R$ 103,40/mês",
  annualLabel: "≈ R$ 1.240,80/ano",
  cards: [
    {
      id: "chatgpt",
      service: "chatgpt",
      planName: "ChatGPT Plus",
      priceLabel: "≈ R$ 103,40/mês",
      nextChargeLabel: "Última cobrança: 19/08 · Sem cobrança recente",
      manageUrl: "https://chatgpt.com/#settings/Subscription",
      manageLabel: "Gerenciar ChatGPT Plus no site da OpenAI, abre em nova aba",
      removeConfirm: "Isso não cancela sua assinatura na OpenAI. Para parar de pagar, use Gerenciar.",
      autoConfirmed: false,
      notice: null,
      logoUrl: "/logos/chatgpt.svg",
      logoFallback: false,
    },
  ],
  suggestions: [
    suggestion({
      id: "netflix",
      planName: "Netflix Padrão",
      priceLabel: "R$ 44,90/mês",
      score: 88,
      label: "Alta chance",
      logoUrl: "/logos/netflix.svg",
      logoFallback: false,
      passed: [true, true, true, true, true],
      details: ["5 meses seguidos", "sempre perto do dia 12", "R$ 44,90", "Netflix", "última em 12/10"],
    }),
    suggestion({
      id: "suno",
      planName: "Suno",
      priceLabel: "≈ R$ 59,90/mês",
      score: 73,
      label: "Média",
      logoUrl: "/logos/suno.svg",
      logoFallback: false,
      passed: [true, false, true, true, true],
      details: ["3 meses seguidos", "dias variados", "R$ 59,90", "Suno", "última em 18/10"],
    }),
    suggestion({
      id: "academia",
      planName: "Academia Fit",
      priceLabel: "R$ 80/mês",
      score: 63,
      label: "Média",
      logoUrl: null,
      logoFallback: true,
      passed: [true, false, true, false, true],
      details: ["3 meses seguidos", "dias variados", "R$ 80", "fora do catálogo", "última em 09/10"],
    }),
  ],
  banners: [{ id: "suggestions", tone: "neutral", text: "Encontramos 3 possíveis assinaturas", actions: [] }],
  footer: "Atualizado há 1 h",
  firstRead: false,
  empty: false,
  connections: [{ institution: "Mercado Pago", statusLabel: "Ativa", expiresLabel: "01/06/2027" }],
  appleChoices: [
    { id: "chatgpt", label: "ChatGPT" },
    { id: "claude", label: "Claude" },
    { id: "grok", label: "Grok" },
  ],
};

test("confirmed cards show the last charge and suggestions show a confidence bar", async ({ page }, testInfo) => {
  await page.route("**/api/plans", async (route) => {
    await route.fulfill({ json: payload });
  });

  const shots: Array<[string, { width: number; height: number }, "light" | "dark"]> = [
    ["mobile-light", { width: 390, height: 844 }, "light"],
    ["desktop-light", { width: 1440, height: 900 }, "light"],
    ["mobile-dark", { width: 390, height: 844 }, "dark"],
    ["desktop-dark", { width: 1440, height: 900 }, "dark"],
  ];

  for (const [name, viewport, scheme] of shots) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await expect(page.getByTestId("next-charge")).toContainText("Última cobrança: 19/08");
    await expect(page.getByTestId("next-charge")).toContainText("Sem cobrança recente");
    await expect(page.getByTestId("next-charge")).not.toContainText("Próxima cobrança");
    await expect(page.getByText("Alta chance").first()).toBeVisible();
    await expect(page.getByText("88%").first()).toBeVisible();
    await expect(page.getByText("5 meses seguidos").first()).toBeVisible();
    const logos = page.locator("img.logo");
    await expect(logos.first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
  }
});
