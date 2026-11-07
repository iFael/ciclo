import { expect, test, type Page } from "@playwright/test";
import { silenceSync } from "./silence-sync";

// Stage 2: the screen against a mocked /api/plans. No Pluggy and no Supabase.

test.beforeEach(async ({ page }) => {
  await silenceSync(page);
});

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
    removeConfirm:
      "Isso não cancela sua assinatura na OpenAI. Para parar de pagar, use Gerenciar.",
    autoConfirmed: false,
    notice: null,
    ...partial,
  };
}

function model(
  cards: Card[],
  extra: { firstRead?: boolean; empty?: boolean } = {},
) {
  return {
    monthlyLabel: cards.length ? "R$ 220,00/mês" : "R$ 0/mês",
    annualLabel: cards.length ? "≈ R$ 2.640,00/ano" : "≈ R$ 0/ano",
    cards,
    suggestions: [],
    banners: [],
    footer: extra.firstRead ? "Ainda sem leitura" : "Atualizado há 2 h",
    firstRead: Boolean(extra.firstRead),
    empty: Boolean(extra.empty),
    connections: [
      { id: "conn-1", title: "Mercado Pago", via: "Pelo MeuPluggy", accounts: [{ id: "acc-1", kind: "card", label: "Mercado Pago", detail: "Cartão de crédito · Mastercard · final 1234" }], status: "active", statusLabel: "Ativa", expiresLabel: "01/11/2027", manageHref: "https://meu.pluggy.ai" },
    ],
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
      manageLabel:
        "Gerenciar Claude Pro no site da Anthropic, abre em nova aba",
    }),
  ];
  await mockPlans(page, model(cards));
  await page.goto("/");
  await expect(page.getByTestId("page-title")).toHaveText("Recontei — suas assinaturas");
  await expect(page.getByTestId("page-subtitle")).toHaveText(
    "Suas assinaturas, encontradas automaticamente no seu cartão.",
  );
  await expect(page.getByTestId("monthly-total")).toHaveText("R$ 220,00/mês");
  await expect(page.getByTestId("annual-total")).toHaveText("≈ R$ 2.640,00");
  await openTab(page, "assinaturas");
  await expect(page.getByTestId("plan-name").first()).toHaveText(
    "ChatGPT Plus",
  );
  const link = page.getByTestId("manage").first();
  await expect(link).toHaveAttribute(
    "href",
    "https://chatgpt.com/#settings/Subscription",
  );
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(link).toHaveAttribute(
    "aria-label",
    "Gerenciar ChatGPT Plus no site da OpenAI, abre em nova aba",
  );
  await expect(page.getByTestId("footer-sync")).toHaveText("Atualizado há 2 h");
});

async function openTab(page: Page, tab: "assinaturas" | "sugestoes") {
  const desktop = await page.evaluate(() => window.innerWidth >= 1024);
  const section = tab === "assinaturas" ? "assinaturas" : "economia";
  await page.getByTestId((desktop ? "nav-" : "nav-mobile-") + section).click();
}

test("adapta assinaturas, sugestões e painel a celular, tablet e desktop", async ({ page }) => {
  const cards = [card({}), card({ id: "sub-2", service: "claude", planName: "Claude Pro" })];
  await mockPlans(page, {
    ...model(cards),
    suggestions: [
      { id: "s1", planName: "Claude Pro", label: "Pode ser recorrente", checked: false, priceLabel: "≈ R$ 113,85/mês", apple: false },
      { id: "s2", planName: "Assinatura via Apple", label: "Pode ser recorrente", checked: false, priceLabel: "≈ R$ 1,90/mês", apple: true },
    ],
    banners: [{ id: "suggestions", tone: "neutral", text: "Encontramos 2 possíveis assinaturas", actions: [] }],
  });

  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("monthly-total")).toBeVisible();
  await openTab(page, "assinaturas");
  const mobile = await page.getByTestId("plan-card").all();
  expect(mobile).toHaveLength(2);
  const first = await mobile[0].boundingBox();
  const second = await mobile[1].boundingBox();
  expect(second!.y).toBeGreaterThan(first!.y + 40);
  expect(Math.abs(first!.x - second!.x)).toBeLessThan(8);
  await openTab(page, "sugestoes");
  await expect(page.getByTestId("suggestion")).toHaveCount(1);
  await expect(page.getByTestId("suggestion-position")).toHaveText("1 de 2");
  await page.getByTestId("suggestion-next").click();
  await expect(page.getByTestId("suggestion-position")).toHaveText("2 de 2");
  await expect(page.getByTestId("suggestion-next")).toBeDisabled();

  await openTab(page, "assinaturas");
  await page.setViewportSize({ width: 768, height: 900 });
  const tablet = await page.getByTestId("plan-card").all();
  const tabletLeft = await tablet[0].boundingBox();
  const tabletRight = await tablet[1].boundingBox();
  expect(Math.abs(tabletLeft!.y - tabletRight!.y)).toBeLessThan(12);
  expect(tabletRight!.x).toBeGreaterThan(tabletLeft!.x + 200);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByTestId("recontei-nav")).toBeVisible();
  await expect(page.getByTestId("recontei-bottom-nav")).toBeHidden();
  const desktop = await page.getByTestId("plan-card").all();
  const row1 = await desktop[0].boundingBox();
  const row2 = await desktop[1].boundingBox();
  expect(row2!.y).toBeGreaterThan(row1!.y + 40);
  await openTab(page, "sugestoes");
  await expect(page.getByTestId("suggestion")).toHaveCount(1);
  await expect(page.getByTestId("suggestion-position")).toHaveText("2 de 2");
  await expect.poll(async () =>
    page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
  ).toBe(true);
});

test("remover persiste depois de recarregar e desfazer traz o plano de volta", async ({
  page,
}) => {
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
  await openTab(page, "assinaturas");
  await page.getByTestId("remove").click();
  await expect(page.getByTestId("remove-dialog")).toContainText(
    "Isso não cancela sua assinatura na OpenAI. Para parar de pagar, use Gerenciar.",
  );
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

function suggestion(id: string, planName: string, priceLabel: string) {
  return {
    id,
    planName,
    label: "Pode ser recorrente",
    checked: false,
    priceLabel,
    apple: false,
  };
}

function plansWith(phase: "open" | "confirmed") {
  const claude = suggestion("claude", "Claude Pro", "≈ R$ 113,85/mês");
  const suno = suggestion("suno", "Suno Inc", "R$ 51,75/mês");
  const suggestions = phase === "confirmed" ? [suno] : [claude, suno];
  const cards =
    phase === "confirmed"
      ? [
          card({
            id: "claude",
            service: "claude",
            planName: "Claude Pro",
            priceLabel: "≈ R$ 113,85/mês",
            nextChargeLabel: "Próxima cobrança: 15/11, em 14 dias",
            manageUrl: "https://claude.ai/settings/billing",
            manageLabel:
              "Gerenciar Claude Pro no site da Anthropic, abre em nova aba",
            removeConfirm:
              "Isso não cancela sua assinatura na Anthropic. Para parar de pagar, use Gerenciar.",
          }),
        ]
      : [];
  const noun =
    suggestions.length === 1 ? "possível assinatura" : "possíveis assinaturas";
  return {
    ...model(cards),
    monthlyLabel: phase === "confirmed" ? "≈ R$ 113,85/mês" : "R$ 0/mês",
    annualLabel: phase === "confirmed" ? "≈ R$ 1.366,20/ano" : "≈ R$ 0/ano",
    suggestions,
    banners: [
      {
        id: "suggestions",
        tone: "neutral",
        text: `Encontramos ${suggestions.length} ${noun}`,
        actions: [],
      },
    ],
  };
}

async function routeSuggestionFlow(page: Page) {
  let phase: "open" | "confirmed" = "open";
  await page.route("**/api/plans", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        action?: string;
        id?: string;
      };
      if (
        body.id === "claude" &&
        (body.action === "confirm" || body.action === "undo")
      )
        phase = "confirmed";
      if (body.id === "claude" && body.action === "remove") phase = "open";
    }
    await route.fulfill({ json: plansWith(phase) });
  });
}

test("confirmar, remover e desfazer atualizam a lista sem recarregar", async ({ page }) => {
  await routeSuggestionFlow(page);
  await page.goto("/");
  await expect(page.getByTestId("monthly-total")).toBeVisible();
  await openTab(page, "sugestoes");
  await expect(page.getByTestId("suggestion")).toHaveCount(1);
  await expect(page.getByTestId("suggestion-dot")).toHaveCount(2);
  await page.getByTestId("suggestion").filter({ hasText: "Claude Pro" }).getByTestId("suggestion-yes").click();
  await expect(page.getByTestId("added-toast")).toContainText("Adicionado às assinaturas");
  await expect(page.getByTestId("suggestion").filter({ hasText: "Claude Pro" })).toHaveCount(0);
  await expect(page.getByTestId("plan-card")).toHaveCount(0);

  await page.getByTestId("added-toast-open").click();
  await expect(page).toHaveURL(/aba=assinaturas/);
  await expect(page.getByTestId("plan-card")).toHaveCount(1);
  await expect(page.getByTestId("plan-name")).toHaveText("Claude Pro");
  await page.getByTestId("nav-mobile-gastos").click();
  await expect(page.getByTestId("monthly-total")).toHaveText("≈ R$ 113,85/mês");
  await openTab(page, "assinaturas");

  await page.getByTestId("remove").click();
  await page.getByTestId("remove-confirm").click();
  await expect(page.getByTestId("undo-toast")).toContainText("Plano removido do Recontei.");
  await expect(page.getByTestId("plan-card")).toHaveCount(0);
  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByTestId("undo-toast")).toBeHidden();
  await openTab(page, "sugestoes");
  await expect(page.getByTestId("suggestion").filter({ hasText: "Claude Pro" })).toHaveCount(0);
  await openTab(page, "assinaturas");
  await expect(page.getByTestId("plan-card")).toHaveCount(1);
});

test("o aviso de desfazer some sozinho depois de alguns segundos", async ({
  page,
}) => {
  await routeSuggestionFlow(page);
  await page.goto("/");
  await openTab(page, "sugestoes");
  await page
    .getByTestId("suggestion")
    .filter({ hasText: "Claude Pro" })
    .getByTestId("suggestion-yes")
    .click();
  await openTab(page, "assinaturas");
  await page.getByTestId("remove").click();
  await page.getByTestId("remove-confirm").click();
  await expect(page.getByTestId("undo-toast")).toBeVisible();
  await expect(page.getByTestId("undo-toast")).toBeHidden({ timeout: 8000 });
  await expect(page.getByTestId("plan-card")).toHaveCount(0);
  await openTab(page, "sugestoes");
  await expect(
    page.getByText("Encontramos 2 possíveis assinaturas"),
  ).toBeVisible();
  await expect(
    page.getByTestId("suggestion").filter({ hasText: "Claude Pro" }),
  ).toBeVisible();
});

test("mostra a primeira leitura, a lista vazia e o erro de carga", async ({
  page,
}) => {
  await mockPlans(page, model([], { firstRead: true }));
  await page.goto("/");
  await expect(page.getByTestId("first-read")).toHaveText(
    "Primeira leitura em até 24 horas.",
  );

  await page.unroute("**/api/plans");
  await mockPlans(page, model([], { empty: true }));
  await page.reload();
  await openTab(page, "assinaturas");
  await expect(page.getByTestId("empty")).toHaveText(
    "Nenhuma assinatura encontrada",
  );

  await page.unroute("**/api/plans");
  await mockPlans(page, {}, true);
  await page.reload();
  await expect(page.getByTestId("load-error")).toHaveText(
    "Não foi possível carregar seus planos.",
  );
});

test("navegação preserva avisos, sugestões e total confirmado", async ({ page }) => {
  await mockPlans(page, {
    ...model([card({})]),
    suggestions: [suggestion("suno", "Suno Inc", "R$ 51,75/mês")],
    banners: [
      { id: "still:sub-1:2026-06-01", tone: "neutral", text: "Ainda cobrando: ChatGPT Plus em 01/06",
        actions: [{ id: "back", label: "Voltar a acompanhar", action: "restore-charging", targetId: "sub-1" }] },
      { id: "conn:1", tone: "red", text: "Conexão vencida.", actions: [] },
      { id: "suggestions", tone: "neutral", text: "Encontramos 1 possível assinatura", actions: [] },
    ],
  });
  await page.goto("/");
  await expect(page.getByTestId("recontei-bottom-nav").getByRole("button")).toHaveCount(4);
  await expect(page.getByTestId("monthly-total")).toBeVisible();
  await expect(page.getByTestId("connection-banner")).toContainText("Conexão vencida.");
  await openTab(page, "assinaturas");
  await expect(page.getByText("Ainda cobrando: ChatGPT Plus em 01/06")).toBeVisible();
  await expect(page.getByTestId("plan-card")).toHaveCount(1);
  await openTab(page, "sugestoes");
  await expect(page.getByTestId("suggestion")).toHaveCount(1);
  await expect(page.getByTestId("plan-card")).toHaveCount(0);

  await page.unroute("**/api/plans");
  await mockPlans(page, {
    ...model([]), suggestions: [suggestion("suno", "Suno Inc", "R$ 51,75/mês"),
      suggestion("pix", "Pix recebido", "R$ 250/mês")],
    banners: [{ id: "suggestions", tone: "neutral", text: "Encontramos 2 possíveis assinaturas", actions: [] }],
  });
  await page.goto("/");
  await expect(page.getByTestId("monthly-total")).toBeVisible();
  await openTab(page, "sugestoes");
  await expect(page.getByTestId("suggestion-dot")).toHaveCount(2);
});

test("os links legados de abas persistem no reload e no histórico", async ({ page }) => {
  await mockPlans(page, {
    ...model([card({}), card({ id: "sub-2", service: "claude", planName: "Claude Pro" })]),
    suggestions: [suggestion("suno", "Suno Inc", "R$ 51,75/mês")],
    banners: [{ id: "suggestions", tone: "neutral", text: "Encontramos 1 possível assinatura", actions: [] }],
  });
  await page.goto("/?aba=sugestoes");
  await expect(page.getByTestId("nav-mobile-economia")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("suggestion")).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId("nav-mobile-economia")).toHaveAttribute("aria-current", "page");

  await page.goto("/?aba=assinaturas");
  await expect(page.getByTestId("plan-card")).toHaveCount(2);
  await openTab(page, "sugestoes");
  await expect(page).toHaveURL(/aba=sugestoes/);
  await page.goBack();
  await expect(page.getByTestId("nav-mobile-assinaturas")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("plan-card")).toHaveCount(2);
  await page.goForward();
  await expect(page.getByTestId("nav-mobile-economia")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("suggestion")).toHaveCount(1);
});

test("cada aba tem um estado vazio com caminho para a outra", async ({
  page,
}) => {
  await mockPlans(page, {
    ...model([]),
    suggestions: [suggestion("suno", "Suno Inc", "R$ 51,75/mês")],
    banners: [
      {
        id: "suggestions",
        tone: "neutral",
        text: "Encontramos 1 possível assinatura",
        actions: [],
      },
    ],
  });
  await page.goto("/?aba=assinaturas");
  await expect(page.getByTestId("empty-assinaturas")).toBeVisible();
  await expect(page.getByTestId("empty-assinaturas")).toContainText(
    "Nenhuma assinatura confirmada",
  );
  await page.getByTestId("empty-goto-suggestions").click();
  await expect(page).toHaveURL(/aba=sugestoes/);
  await expect(page.getByTestId("suggestion")).toHaveCount(1);

  await page.unroute("**/api/plans");
  await mockPlans(page, model([card({})]));
  await page.goto("/?aba=sugestoes");
  await expect(page.getByTestId("empty-sugestoes")).toBeVisible();
  await expect(page.getByTestId("empty-sugestoes")).toContainText(
    "Nenhuma sugestão no momento",
  );
  await page.getByTestId("empty-goto-assinaturas").click();
  await expect(page).toHaveURL(/aba=assinaturas/);
  await expect(page.getByTestId("plan-card")).toHaveCount(1);
});

test("o botão Gerenciar mostra onde a assinatura é cobrada e a sugestão da Apple já vem escolhida", async ({ page }) => {
  const cards = [
    { ...card({}), manageButton: "Gerenciar no site" },
    {
      ...card({
        id: "sub-2",
        planName: "ChatGPT Plus",
        manageUrl: "https://apps.apple.com/account/subscriptions",
        manageLabel: "Gerenciar ChatGPT Plus na Apple, abre em nova aba",
      }),
      channel: "apple",
      manageButton: "Gerenciar na Apple",
    },
    {
      ...card({
        id: "sub-3",
        planName: "Duolingo",
        manageUrl: "https://play.google.com/store/account/subscriptions",
        manageLabel: "Gerenciar Duolingo no Google Play, abre em nova aba",
      }),
      channel: "google-play",
      manageButton: "Gerenciar no Google Play",
    },
  ];
  const posted: unknown[] = [];
  await page.route("**/api/plans", async (route) => {
    if (route.request().method() === "POST") posted.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        ...model(cards),
        suggestions: [
          {
            id: "s-apple",
            planName: "Assinatura via Apple",
            label: "2 meses seguidos",
            checked: false,
            priceLabel: "R$ 99,90/mês",
            apple: true,
            appleGuess: {
              service: "chatgpt",
              serviceName: "ChatGPT",
              planName: "ChatGPT Plus",
              reason: "Parece ChatGPT Plus: a cobrança direta parou em 20/09 e esta, pela Apple, começou em 25/09.",
              replaces: "sub-old",
            },
          },
        ],
      },
    });
  });
  await page.goto("/");
  await openTab(page, "assinaturas");
  const links = page.getByTestId("manage");
  await expect(links).toHaveText(["Gerenciar no site", "Gerenciar na Apple", "Gerenciar no Google Play"]);
  await expect(links.nth(1)).toHaveAttribute("href", "https://apps.apple.com/account/subscriptions");
  await expect(links.nth(2)).toHaveAttribute("href", "https://play.google.com/store/account/subscriptions");

  await openTab(page, "sugestoes");
  await expect(page.getByTestId("apple-picker")).toHaveValue("chatgpt");
  await expect(page.getByTestId("apple-guess")).toContainText("Parece ChatGPT Plus");
  await page.getByTestId("suggestion-yes").click();
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toMatchObject({ action: "pick-apple", id: "s-apple", service: "chatgpt", replaces: "sub-old" });
});

test("sem link mostra Adicionar link e abre o campo de edição", async ({ page }) => {
  await mockPlans(page, model([card({
    service: "unknown",
    planName: "Plano desconhecido",
    manageUrl: null,
    manageLabel: "",
    removeConfirm: "Isso não cancela sua assinatura no provedor.",
  })]));
  await page.goto("/");
  await openTab(page, "assinaturas");
  await expect(page.getByTestId("manage")).toHaveCount(0);
  const addLink = page.getByTestId("add-manage-link");
  await expect(addLink).toBeVisible();
  await addLink.click();
  await expect(page.getByTestId("plan-edit-form")).toBeVisible();
  await expect(page.getByTestId("manage-url-input")).toBeVisible();
});

test("alinha preços e ações com e sem link no desktop, sem perder o layout mobile", async ({ page }) => {
  const cards = [
    card({ id: "chatgpt", planName: "ChatGPT Plus" }),
    card({ id: "claude", planName: "Claude Pro", priceLabel: "R$ 113,85/mês" }),
    card({ id: "ifood", service: "unknown", planName: "iFood Clube", priceLabel: "R$ 7,95/mês", manageUrl: null }),
    card({ id: "gran", service: "unknown", planName: "Gran Faculdade", priceLabel: "R$ 77,00/mês", manageUrl: null }),
  ];
  await mockPlans(page, model(cards));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await openTab(page, "assinaturas");

  const rows = page.getByTestId("plan-card");
  await expect(rows).toHaveCount(4);
  const prices = await Promise.all(
    cards.map((_, index) => rows.nth(index).getByTestId("plan-price").boundingBox()),
  );
  const priceEdges = prices.map((box) => box!.x + box!.width);
  expect(Math.max(...priceEdges) - Math.min(...priceEdges)).toBeLessThan(2);

  const actions = await Promise.all([
    rows.nth(0).getByTestId("manage").boundingBox(),
    rows.nth(2).getByTestId("add-manage-link").boundingBox(),
  ]);
  expect(Math.abs(actions[0]!.x - actions[1]!.x)).toBeLessThan(2);
  expect(Math.abs(actions[0]!.width - actions[1]!.width)).toBeLessThan(2);
  await rows.nth(2).getByTestId("add-manage-link").click();
  await expect(rows.nth(2).getByTestId("plan-edit-form")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(rows.nth(2).getByTestId("add-manage-link")).toBeVisible();
  await expect(rows.nth(2).getByTestId("remove")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});
