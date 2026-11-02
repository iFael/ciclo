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
      { date: "2026-10-05", label: "05/10/2026", amount: "R$ 189,90" },
      { date: "2026-09-05", label: "05/09/2026", amount: "R$ 189,90" },
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
    charges: [{ date: "2026-02-12", label: "12/02/2026", amount: "R$ 49,90" }],
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
    await expect(page.getByTestId("plan-name").filter({ hasText: "Gran Faculdade" })).toBeVisible();
    expect(confirmed).toBe(true);
    confirmed = false;
  }
});
