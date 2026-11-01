import { expect, test, type Page } from "@playwright/test";

// Stage 2: the screen against a mocked /api/plans. No Pluggy and no Supabase.

type Card = {
  id: string;
  service: string;
  planName: string;
  priceLabel: string;
  nextChargeLabel: string;
  manageUrl: string | null;
  manageLabel: string;
  removeConfirm: string;
  autoConfirmed: boolean;
  notice: string | null;
};

function card(partial: Partial<Card>): Card {
  return {
    id: "sub-1",
    service: "chatgpt",
    planName: "ChatGPT Plus",
    priceLabel: "≈ R$ 110/mês",
    nextChargeLabel: "Próxima cobrança: 19/11, em 18 dias",
    manageUrl: "https://chatgpt.com/#settings/Subscription",
    manageLabel: "Gerenciar ChatGPT Plus no site da OpenAI, abre em nova aba",
    removeConfirm: "Isso não cancela sua assinatura na OpenAI. Para parar de pagar, use Gerenciar.",
    autoConfirmed: false,
    notice: null,
    ...partial,
  };
}

function model(cards: Card[], extra: { firstRead?: boolean; empty?: boolean } = {}) {
  return {
    monthlyLabel: cards.length ? "R$ 220/mês" : "R$ 0/mês",
    annualLabel: cards.length ? "≈ R$ 2.640/ano" : "≈ R$ 0/ano",
    cards,
    suggestions: [],
    banners: [],
    footer: extra.firstRead ? "Ainda sem leitura" : "Atualizado há 2 h",
    firstRead: Boolean(extra.firstRead),
    empty: Boolean(extra.empty),
    connections: [{ institution: "Banco teste", statusLabel: "Ativa", expiresLabel: "01/12/2026" }],
    appleChoices: [
      { id: "chatgpt", label: "ChatGPT" },
      { id: "claude", label: "Claude" },
      { id: "grok", label: "Grok" },
    ],
  };
}

async function mockPlans(page: Page, payload: unknown, fail = false) {
  await page.route("**/api/plans", async (route) => {
    if (fail) {
      await route.fulfill({ status: 500, json: { error: "fail" } });
      return;
    }
    await route.fulfill({ json: payload });
  });
}

test("mostra o total, o plano e o link de gerenciar", async ({ page }) => {
  const cards = [
    card({}),
    card({
      id: "sub-2",
      service: "claude",
      planName: "Claude Pro",
      manageUrl: "https://claude.ai/settings/billing",
      manageLabel: "Gerenciar Claude Pro no site da Anthropic, abre em nova aba",
    }),
  ];
  await mockPlans(page, model(cards));
  await page.goto("/");
  await expect(page.getByTestId("page-title")).toHaveText("Meus planos");
  await expect(page.getByTestId("page-subtitle")).toHaveText("Suas assinaturas, encontradas automaticamente no seu cartão.");
  await expect(page.getByTestId("monthly-total")).toHaveText("R$ 220/mês");
  await expect(page.getByTestId("annual-total")).toHaveText("≈ R$ 2.640/ano");
  await expect(page.getByTestId("plan-name").first()).toHaveText("ChatGPT Plus");
  const link = page.getByTestId("manage").first();
  await expect(link).toHaveAttribute("href", "https://chatgpt.com/#settings/Subscription");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(link).toHaveAttribute("aria-label", "Gerenciar ChatGPT Plus no site da OpenAI, abre em nova aba");
  await expect(page.getByTestId("footer-sync")).toHaveText("Atualizado há 2 h");
});

test("empilha os cartões no celular e usa duas colunas no desktop", async ({ page }) => {
  await mockPlans(page, model([card({}), card({ id: "sub-2", service: "claude", planName: "Claude Pro" })]));
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("plan-card")).toHaveCount(2);
  const mobile = await page.getByTestId("plan-card").all();
  const first = await mobile[0].boundingBox();
  const second = await mobile[1].boundingBox();
  expect(second!.y).toBeGreaterThan(first!.y + 40);

  await page.setViewportSize({ width: 1280, height: 800 });
  const desktop = await page.getByTestId("plan-card").all();
  const left = await desktop[0].boundingBox();
  const right = await desktop[1].boundingBox();
  expect(Math.abs(left!.y - right!.y)).toBeLessThan(20);
});

test("remover persiste depois de recarregar e desfazer traz o plano de volta", async ({ page }) => {
  let removed = false;
  await page.route("**/api/plans", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { action?: string };
      if (body.action === "remove") removed = true;
      if (body.action === "undo") removed = false;
    }
    await route.fulfill({ json: model(removed ? [] : [card({})]) });
  });
  await page.goto("/");
  await page.getByTestId("remove").click();
  await expect(page.getByTestId("remove-dialog")).toContainText("Isso não cancela sua assinatura na OpenAI. Para parar de pagar, use Gerenciar.");
  await page.getByTestId("remove-confirm").click();
  await expect(page.getByTestId("undo-toast")).toBeVisible();
  await expect(page.getByTestId("plan-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByTestId("plan-card")).toHaveCount(1);

  await page.getByTestId("remove").click();
  await page.getByTestId("remove-confirm").click();
  await page.reload();
  await expect(page.getByTestId("plan-card")).toHaveCount(0);
});

test("mostra a primeira leitura, a lista vazia e o erro de carga", async ({ page }) => {
  await mockPlans(page, model([], { firstRead: true }));
  await page.goto("/");
  await expect(page.getByTestId("first-read")).toHaveText("Primeira leitura em até 24 horas.");

  await page.unroute("**/api/plans");
  await mockPlans(page, model([], { empty: true }));
  await page.reload();
  await expect(page.getByTestId("empty")).toHaveText("Nenhuma assinatura encontrada");

  await page.unroute("**/api/plans");
  await mockPlans(page, {}, true);
  await page.reload();
  await expect(page.getByTestId("load-error")).toHaveText("Não foi possível carregar seus planos.");
});
