import { expect, test } from "@playwright/test";
import { silenceSync } from "./silence-sync";

test.beforeEach(async ({ page }) => {
  await silenceSync(page);
});

const checks = (passed: boolean[], details: string[]) =>
  [
    ["streak", "Cobrado nos últimos meses"],
    ["day", "Dias do mês parecidos"],
    ["amount", "Valor estável"],
    ["catalog", "Serviço conhecido"],
    ["recent", "Cobrança recente"],
    ["learned", "Suas escolhas"],
  ]
    .slice(0, details.length)
    .map(([id, label], index) => ({ id, label, detail: details[index], passed: passed[index] }));

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
  inactiveCards: [
    {
      id: "spotify",
      service: "spotify",
      planName: "Spotify Premium",
      priceLabel: "R$ 21,90/mês",
      nextChargeLabel: "Última cobrança: 05/08 · Sem cobrança recente",
      manageUrl: null,
      manageLabel: "",
      removeConfirm: "Isso não cancela sua assinatura no Spotify.",
      autoConfirmed: false,
      notice: null,
      logoUrl: "/logos/spotify.svg",
      logoFallback: false,
      inactiveLabel: "Sem cobrança desde 05/08",
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
      passed: [true, false, true, false, true, true],
      details: ["2 meses seguidos", "dias variados", "R$ 80", "fora do catálogo", "última em 09/10", "parecido com o que você confirmou"],
    }),
  ],
  banners: [{ id: "suggestions", tone: "neutral", text: "Encontramos 3 possíveis assinaturas", actions: [] }],
  footer: "Atualizado há 1 h",
  firstRead: false,
  empty: false,
  connections: [{ id: "conn-1", title: "Mercado Pago", via: "Pelo MeuPluggy", accounts: [{ id: "acc-1", kind: "card", label: "Mercado Pago", detail: "Cartão de crédito · Mastercard · final 1234" }], status: "active", statusLabel: "Ativa", expiresLabel: "01/11/2027", manageHref: "https://meu.pluggy.ai" }],
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

  const shots: Array<[{ width: number; height: number }, "light" | "dark"]> = [
    [{ width: 390, height: 844 }, "light"],
    [{ width: 1440, height: 900 }, "light"],
    [{ width: 390, height: 844 }, "dark"],
    [{ width: 1440, height: 900 }, "dark"],
  ];

  for (const [viewport, scheme] of shots) {
    const size = viewport.width === 390 ? "mobile" : "desktop";
    await page.addInitScript((theme) => {
      if (theme === "light") localStorage.setItem("recontei-theme", "light");
      else localStorage.removeItem("recontei-theme");
    }, scheme);
    await page.setViewportSize(viewport);
    await page.goto("/?aba=assinaturas");
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await expect(page.getByTestId(size === "mobile" ? "recontei-bottom-nav" : "recontei-nav")).toBeVisible();
    await expect(page.getByTestId("next-charge")).toContainText("Última cobrança: 19/08");
    await expect(page.getByTestId("next-charge")).toContainText("Sem cobrança recente");
    await expect(page.getByTestId("next-charge")).not.toContainText("Próxima cobrança");
    await expect(page.getByTestId("plan-card").locator("img.logo")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${size}-${scheme}-assinaturas.png`), fullPage: true });

    if (size === "mobile") await expect(page.getByTestId("suggestion-peek")).toHaveCount(3);
    await page.getByTestId(size === "mobile" ? "nav-mobile-economia" : "nav-economia").click();
    await expect(page.getByTestId("panel-sugestoes")).toBeVisible();
    const cards = page.getByTestId("suggestion");
    await expect(cards).toHaveCount(1);
    await expect(page.getByTestId("suggestion-dot")).toHaveCount(3);
    await expect(cards).toContainText("Netflix Padrão");
    await expect(cards).toContainText("Alta chance");
    await expect(cards).toContainText("88%");
    await expect(cards).toContainText("5 meses seguidos");
    await page.getByTestId("suggestion-next").click();
    await expect(cards).toContainText("Suno");
    await page.getByTestId("suggestion-next").click();
    await expect(cards).toContainText("Academia Fit");
    await expect(cards).toContainText("parecido com o que você confirmou");
    await expect(page.getByTestId("suggestion-position")).toHaveText("3 de 3");
    await expect(cards.locator("img.logo")).toHaveCount(0);
    await page.getByTestId("suggestion-dot").first().click();
    await expect(cards.locator("img.logo")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${size}-${scheme}-sugestoes.png`), fullPage: true });
  }

  await page.getByTestId("nav-assinaturas").click();
  await expect(page.getByTestId("plan-logo")).toHaveCount(1);
  await page.getByTestId("plan-logo").click();
  await expect(page.getByTestId("plan-edit-form")).toHaveCount(0);
  await expect(page.getByTestId("manage")).toBeVisible();
});
