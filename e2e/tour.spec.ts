import { expect, test, type Page } from "@playwright/test";
import { silenceSync } from "./silence-sync";

// The welcome tour against a mocked /api/plans and /api/tutorial.

function card(id: string, planName: string, manageUrl: string | null) {
  return {
    id,
    service: "chatgpt",
    planName,
    priceLabel: "R$ 110,00/mês",
    nextChargeLabel: "Próxima cobrança: 19/11, em 18 dias",
    manageUrl,
    manageLabel: `Gerenciar ${planName}, abre em nova aba`,
    removeConfirm: "Isso não cancela sua assinatura.",
    autoConfirmed: false,
    notice: null,
  };
}

function model(withCards: boolean) {
  const cards = withCards ? [card("sub-1", "ChatGPT Plus", "https://chatgpt.com/#settings/Subscription"), card("sub-2", "Claude Pro", null)] : [];
  return {
    monthlyLabel: withCards ? "R$ 220,00/mês" : "R$ 0/mês",
    annualLabel: withCards ? "≈ R$ 2.640,00/ano" : "≈ R$ 0/ano",
    cards,
    suggestions: [
      { id: "s-1", planName: "Spotify", label: null, checked: false, priceLabel: "R$ 21,90/mês", apple: false, logoUrl: null, logoFallback: true, confidence: null },
    ],
    banners: [],
    footer: "Atualizado há 2 h",
    firstRead: false,
    empty: false,
    connections: [],
    appleChoices: [],
  };
}

async function setup(page: Page, { seen, withCards = true }: { seen: boolean; withCards?: boolean }) {
  await silenceSync(page);
  await page.route("**/api/plans", (route) => route.fulfill({ json: model(withCards) }));
  const saved: unknown[] = [];
  await page.route("**/api/tutorial", async (route) => {
    if (route.request().method() === "POST") {
      saved.push(route.request().postDataJSON());
      await route.fulfill({ json: { seen: true } });
      return;
    }
    await route.fulfill({ json: { seen } });
  });
  return saved;
}

test("um usuário novo vê o tour, com passos, contador e Voltar", async ({ page }) => {
  const saved = await setup(page, { seen: false });
  await page.goto("/");
  const tour = page.getByTestId("tour-card");
  await expect(tour).toHaveAttribute("data-step", "welcome");
  await expect(page.getByTestId("tour-count")).toHaveText("1 de 6");
  await page.getByTestId("tour-next").click();
  await expect(tour).toHaveAttribute("data-step", "suggestions");
  await expect(page.getByTestId("tour-spotlight")).toBeVisible();
  await page.getByTestId("tour-next").click();
  await expect(tour).toHaveAttribute("data-step", "plans");
  // The plans step opens the Assinaturas tab on the phone.
  await expect(page.getByTestId("nav-mobile-assinaturas")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("tour-spotlight")).toBeVisible();
  await page.getByTestId("tour-back").click();
  await expect(tour).toHaveAttribute("data-step", "suggestions");
  await page.getByTestId("tour-next").click();
  await page.getByTestId("tour-next").click();
  await expect(tour).toHaveAttribute("data-step", "manage");
  await page.getByTestId("tour-next").click();
  await expect(tour).toHaveAttribute("data-step", "search");
  await page.getByTestId("tour-next").click();
  await expect(tour).toHaveAttribute("data-step", "menu");
  await expect(page.getByTestId("tour-next")).toHaveText("Começar");
  await page.getByTestId("tour-next").click();
  await expect(page.getByTestId("tour")).toHaveCount(0);
  await expect.poll(() => saved).toEqual([{ seen: true }]);
});

test("Pular fecha o tour e salva na conta", async ({ page }) => {
  const saved = await setup(page, { seen: false });
  await page.goto("/");
  await page.getByTestId("tour-skip").click();
  await expect(page.getByTestId("tour")).toHaveCount(0);
  await expect.poll(() => saved).toEqual([{ seen: true }]);
});

test("quem já viu não vê de novo, mas pode abrir pelo menu", async ({ page }) => {
  await setup(page, { seen: true });
  await page.goto("/");
  await page.getByTestId("nav-mobile-assinaturas").click();
  await expect(page.getByTestId("plan-card").first()).toBeVisible();
  await expect(page.getByTestId("tour")).toHaveCount(0);
  await page.getByTestId("menu").click();
  await page.getByTestId("menu-tutorial").click();
  await expect(page.getByTestId("tour-card")).toHaveAttribute("data-step", "welcome");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tour")).toHaveCount(0);
});

test("com a lista vazia, mostra um cartão de exemplo", async ({ page }) => {
  await setup(page, { seen: false, withCards: false });
  await page.goto("/");
  await expect(page.getByTestId("tour-count")).toHaveText("1 de 5");
  await page.getByTestId("tour-next").click();
  await page.getByTestId("tour-next").click();
  await expect(page.getByTestId("tour-card")).toHaveAttribute("data-step", "sample");
  await expect(page.getByTestId("tour-sample")).toBeVisible();
});

test("no desktop, destaca a logo sem torná-la clicável", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 });
  await setup(page, { seen: false });
  await page.goto("/");
  await page.getByTestId("tour-next").click();
  await page.getByTestId("tour-next").click();
  await expect(page.getByTestId("tour-card")).toHaveAttribute("data-step", "plans");
  const hole = await page.getByTestId("tour-spotlight").boundingBox();
  const icon = await page.getByTestId("plan-logo").first().boundingBox();
  expect(hole && icon).toBeTruthy();
  await expect
    .poll(async () => {
      const h = await page.getByTestId("tour-spotlight").boundingBox();
      const i = await page.getByTestId("plan-logo").first().boundingBox();
      return h && i ? Math.abs(Math.round(h.x + 8 - i.x)) <= 2 : null;
    })
    .toBe(true);
  await expect
    .poll(async () => {
      const h = await page.getByTestId("tour-spotlight").boundingBox();
      const i = await page.getByTestId("plan-logo").first().boundingBox();
      return h && i ? Math.abs(Math.round(h.y + 8 - i.y)) <= 2 : null;
    })
    .toBe(true);
});
