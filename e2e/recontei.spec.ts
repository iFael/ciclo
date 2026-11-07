import { expect, test } from "@playwright/test";
import { silenceSync } from "./silence-sync";

const payload = {
  monthlyLabel: "R$ 210,00/mês",
  annualLabel: "≈ R$ 2.520,00/ano",
  spendingHistory: [{ month: "2026-08", total: 240 }, { month: "2026-09", total: 225 }, { month: "2026-10", total: 210 }],
  spendingTrend: { percent: -7, current: 210, previous: 225 },
  cards: [
    { id: "one", service: "chatgpt", planName: "ChatGPT Plus", priceLabel: "R$ 110,00/mês", monthlyAmount: 110,
      nextChargeLabel: "Última cobrança: 19/10", upcomingChargeDate: "2026-11-19",
      manageUrl: "https://chatgpt.com", manageLabel: "Gerenciar ChatGPT Plus", removeConfirm: "Remover", autoConfirmed: false, notice: null,
      logoUrl: "/logos/chatgpt.svg", logoFallback: false },
    { id: "two", service: "claude", planName: "Claude Pro", priceLabel: "R$ 100,00/mês", monthlyAmount: 100,
      nextChargeLabel: "Última cobrança: 22/10", upcomingChargeDate: null,
      manageUrl: null, manageLabel: "", removeConfirm: "Remover", autoConfirmed: false, notice: null,
      logoUrl: "/logos/claude.svg", logoFallback: false },
  ],
  suggestions: [{ id: "three", planName: "Outros serviços", priceLabel: "R$ 39,90/mês", label: null, checked: false, apple: false,
    logoUrl: null, logoFallback: true, chargeCount: 3, confidence: null }],
  banners: [], footer: "Atualizado há 1 h", firstRead: false, empty: false,
  connections: [], appleChoices: [],
};

test.beforeEach(async ({ page }) => {
  await silenceSync(page);
  await page.route("**/api/tutorial", (route) => route.fulfill({ json: { seen: true } }));
  await page.route("**/api/plans", (route) => route.fulfill({ json: payload }));
});

test("recontei renders premium dashboard and four functional navigation areas", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("monthly-total")).toHaveText("R$ 210,00/mês");
  await expect(page.getByTestId("spending-chart")).toBeVisible();
  await expect(page.getByTestId("spending-trend")).toContainText("↓ -7%");
  await expect(page.getByTestId("recontei-bottom-nav")).toBeVisible();
  const nav = page.getByTestId("recontei-bottom-nav");
  await expect(nav.getByRole("button")).toHaveCount(4);
  await page.getByTestId("nav-mobile-assinaturas").click();
  await expect(page.getByTestId("plan-card")).toHaveCount(2);
  await page.getByTestId("nav-mobile-cobrancas").click();
  await expect(page.getByTestId("upcoming-charges")).toContainText("19/11");
  await page.getByTestId("nav-mobile-economia").click();
  await expect(page.getByTestId("suggestion")).toHaveCount(1);
  await page.getByTestId("nav-mobile-gastos").click();
  await expect(page.getByTestId("recontei-insights")).toContainText("Distribuição dos gastos");
});

test("does not fabricate spending comparisons without enough history", async ({ page }) => {
  await page.route("**/api/plans", (route) => route.fulfill({ json: { ...payload, spendingHistory: [], spendingTrend: null } }));
  await page.goto("/");
  await expect(page.getByTestId("spending-chart-empty")).toBeVisible();
  await expect(page.getByTestId("spending-trend")).toHaveCount(0);
});

test("shows expense increase in red and uses desktop navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 850 });
  await page.route("**/api/plans", (route) => route.fulfill({ json: { ...payload, spendingTrend: { percent: 9, current: 225, previous: 210 } } }));
  await page.goto("/");
  await expect(page.getByTestId("recontei-nav")).toBeVisible();
  await expect(page.getByTestId("recontei-bottom-nav")).toBeHidden();
  await expect(page.getByTestId("spending-trend")).toContainText("↑ +9%");
  await page.getByTestId("nav-assinaturas").click();
  await expect(page.getByTestId("panel-assinaturas")).toBeVisible();
});


test("keeps the selected section in the URL and restores navigation history", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("recontei-overview")).toBeVisible();
  await page.getByTestId("nav-mobile-cobrancas").click();
  await expect(page).toHaveURL(/\?view=cobrancas/);
  await page.reload();
  await expect(page.getByTestId("recontei-billing")).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId("recontei-overview")).toBeVisible();
  await page.goForward();
  await expect(page.getByTestId("recontei-billing")).toBeVisible();
  await page.getByTestId("nav-mobile-assinaturas").click();
  await expect(page).toHaveURL(/\?aba=assinaturas/);
  await expect(page.getByTestId("plan-card")).toHaveCount(2);
  await page.goBack();
  await expect(page.getByTestId("recontei-billing")).toBeVisible();
});


test("migrates the saved light theme from the previous app name", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("ciclo-theme", "light"));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => localStorage.getItem("recontei-theme"))).toBe("light");
  expect(await page.evaluate(() => localStorage.getItem("ciclo-theme"))).toBeNull();
});

test("keeps spending breakdown readable in light theme", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("recontei-theme", "light"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const donutColor = await page.locator('[aria-label="Distribuição das assinaturas por valor"] strong')
    .evaluate((node) => getComputedStyle(node).color);
  expect(donutColor).toBe("rgb(248, 245, 239)");
});
