import { expect, test } from "@playwright/test";
import { silenceSync } from "./silence-sync";

const base = {
  monthlyLabel: "R$ 113,85/mês",
  annualLabel: "≈ R$ 1.366,20/ano",
  cards: [
    {
      id: "claude",
      service: "claude",
      planName: "Claude Pro",
      priceLabel: "≈ R$ 113,85/mês",
      nextChargeLabel: "Última cobrança: 15/10",
      manageUrl: "https://claude.ai/settings/billing",
      manageLabel: "Gerenciar Claude Pro",
      removeConfirm: "Isso não cancela sua assinatura na Anthropic.",
      autoConfirmed: false,
      notice: null,
      logoUrl: "/logos/claude.svg",
      logoFallback: false,
    },
  ],
  suggestions: [],
  banners: [],
  footer: "Atualizado há menos de 1 h",
  firstRead: false,
  empty: false,
  connections: [],
  appleChoices: [],
};

const groups = [
  {
    key: "GRAN FACULDADE",
    name: "Gran Faculdade",
    count: 10,
    months: 10,
    amountLabel: "R$ 189,90",
    lastLabel: "05/10/2026",
    status: null,
    charges: [
      { id: "gran-1", date: "2026-10-05", label: "05/10/2026", amount: "R$ 189,90", description: "GRAN FACULDADE" },
      { id: "gran-2", date: "2026-09-05", label: "05/09/2026", amount: "R$ 189,90", description: "GRAN FACULDADE" },
    ],
  },
  {
    key: "GRAN CURSOS ONLINE",
    name: "Gran Cursos Online",
    count: 1,
    months: 1,
    amountLabel: "R$ 49,90",
    lastLabel: "12/02/2026",
    status: "ignored",
    charges: [{ id: "gran-3", date: "2026-02-12", label: "12/02/2026", amount: "R$ 49,90", description: "GRAN CURSOS ONLINE" }],
  },
];

test("a busca no extrato agrupa por comerciante e marca como assinatura", async ({ page }, testInfo) => {
  await silenceSync(page);
  let confirmed = false;
  await page.route("**/api/plans", async (route) => {
    await route.fulfill({ json: base });
  });
  await page.route("**/api/search**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      confirmed = true;
      expect(request.postDataJSON()).toEqual({ key: "GRAN FACULDADE" });
      await route.fulfill({
        json: {
          ...base,
          monthlyLabel: "R$ 303,75/mês",
          cards: [
            ...base.cards,
            { ...base.cards[0], id: "gran", service: "unknown", planName: "Gran Faculdade", priceLabel: "R$ 189,90/mês", nextChargeLabel: "Última cobrança: 05/10", manageUrl: null, logoUrl: null, logoFallback: true },
          ],
        },
      });
      return;
    }
    const q = new URL(request.url()).searchParams.get("q");
    await route.fulfill({ json: { groups: q === "zzz" ? [] : groups } });
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.getByTestId("search-open").click();
    const dialog = page.getByTestId("search-dialog");
    await expect(dialog).toBeVisible();
    await page.getByTestId("search-input").fill("zzz");
    await expect(page.getByTestId("search-empty")).toContainText("Nada com");
    await page.getByTestId("search-input").fill("gran");
    await expect(page.getByTestId("search-group")).toHaveCount(2);
    await expect(page.getByTestId("search-group").nth(0)).toContainText("10 cobranças · 10 mesesR$ 189,90 · 05/10/2026");
    await expect(page.getByTestId("search-group").nth(1)).toContainText("Você recusou");
    await page.getByTestId("search-group").nth(0).getByRole("button", { name: /Gran Faculdade/ }).click();
    await expect(page.getByTestId("search-group").nth(0)).toContainText("05/09/2026");
    await page.waitForTimeout(300);
    await page.screenshot({ path: testInfo.outputPath(`search-${viewport.width}.png`) });
    await page.getByTestId("search-confirm").first().click();
    await expect(page.getByTestId("search-group").nth(0)).toContainText("Já é plano");
    await page.keyboard.press("Escape");
    await page.getByTestId(viewport.width >= 1024 ? "nav-assinaturas" : "nav-mobile-assinaturas").click();
    await expect(page.getByTestId("plan-name").filter({ hasText: "Gran Faculdade" })).toBeVisible();
    expect(confirmed).toBe(true);
    confirmed = false;
  }
});

test("vincula pagamentos Pix com descrições distintas ao plano existente, apenas após seleção", async ({ page }) => {
  await silenceSync(page);
  const payments = [
    { id: "pix-aug", date: "2026-08-16", label: "16/08/2026", amount: "R$ 103,40", description: "Pagamento com QR Pix EBANX Ltda." },
    { id: "pix-sep", date: "2026-09-20", label: "20/09/2026", amount: "R$ 103,40", description: "Pix automático Ebanx" },
    { id: "pix-oct", date: "2026-10-19", label: "19/10/2026", amount: "R$ 103,40", description: "Pix automático Ebanx" },
  ];
  let linked = false;
  const chatgpt = { ...base.cards[0], id: "chatgpt", service: "chatgpt", planName: "ChatGPT Plus", priceLabel: "R$ 103,40/mês", nextChargeLabel: "Última cobrança: 19/07" };
  await page.route("**/api/plans", (route) => route.fulfill({ json: { ...base, cards: [chatgpt] } }));
  await page.route("**/api/search**", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({
        action: "link-existing", key: "payee:EBANX", subscriptionId: "chatgpt",
        transactionIds: ["pix-aug", "pix-sep", "pix-oct"],
      });
      linked = true;
      await route.fulfill({ json: { ...base, cards: [{ ...chatgpt, nextChargeLabel: "Última cobrança: 19/10" }] } });
      return;
    }
    await route.fulfill({ json: {
      groups: [{
        key: "payee:EBANX", name: "Ebanx", count: 3, months: 3,
        amountLabel: "R$ 103,40", lastLabel: "19/10/2026", status: linked ? "plan" : null,
        charges: payments,
      }],
      plans: [{ id: "chatgpt", name: "ChatGPT Plus" }],
    } });
  });
  await page.goto("/");
  await page.getByTestId("search-open").click();
  await page.getByTestId("search-input").fill("ebanx");
  const group = page.getByTestId("search-group");
  await expect(group).toContainText("3 cobranças");
  await group.getByRole("button", { name: /Ebanx/ }).click();
  await expect(page.getByTestId("search-charge-select")).toHaveCount(3);
  await page.getByTestId("search-charge-select").nth(0).check();
  await page.getByTestId("search-charge-select").nth(1).check();
  await page.getByTestId("search-charge-select").nth(2).check();
  await page.getByTestId("search-target-plan").selectOption("chatgpt");
  await page.getByTestId("search-link-plan").click();
  await page.keyboard.press("Escape");
  await page.getByTestId("nav-mobile-assinaturas").click();
  await expect(page.getByTestId("plan-card").first()).toContainText("19/10");
  expect(linked).toBe(true);
});
