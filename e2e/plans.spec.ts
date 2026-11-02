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
      {
        institution: "Banco teste",
        statusLabel: "Ativa",
        expiresLabel: "01/12/2026",
      },
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
  await expect(page.getByTestId("page-title")).toHaveText("Meus planos");
  await expect(page.getByTestId("page-subtitle")).toHaveText(
    "Suas assinaturas, encontradas automaticamente no seu cartão.",
  );
  await expect(page.getByTestId("monthly-total")).toHaveText("R$ 220,00/mês");
  await expect(page.getByTestId("annual-total")).toHaveText("≈ R$ 2.640,00/ano");
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
  await page
    .getByTestId(tab === "assinaturas" ? "tab-assinaturas" : "tab-sugestoes")
    .click();
}

test("empilha no celular, abre em colunas no tablet e mostra lista e sugestões lado a lado no desktop", async ({
  page,
}) => {
  const cards = [
    card({}),
    card({ id: "sub-2", service: "claude", planName: "Claude Pro" }),
  ];
  await mockPlans(page, {
    ...model(cards),
    suggestions: [
      {
        id: "s1",
        planName: "Claude Pro",
        label: "Pode ser recorrente",
        checked: false,
        priceLabel: "≈ R$ 113,85/mês",
        apple: false,
      },
      {
        id: "s2",
        planName: "Assinatura via Apple",
        label: "Pode ser recorrente",
        checked: false,
        priceLabel: "≈ R$ 1,90/mês",
        apple: true,
      },
    ],
    banners: [
      {
        id: "suggestions",
        tone: "neutral",
        text: "Encontramos 2 possíveis assinaturas",
        actions: [],
      },
    ],
  });

  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("plan-card")).toHaveCount(2);
  const mobileTab = await page.getByTestId("tab-assinaturas").boundingBox();
  expect(mobileTab!.height).toBeGreaterThanOrEqual(44);
  expect(
    await page
      .locator("header.top")
      .evaluate((element) => getComputedStyle(element).position),
  ).toBe("sticky");
  const mobileScreen = await page.getByTestId("screen").boundingBox();
  expect(mobileScreen!.width).toBeGreaterThan(370);
  expect(mobileScreen!.width).toBeLessThanOrEqual(391);
  const mobile = await page.getByTestId("plan-card").all();
  const mobileFirst = await mobile[0].boundingBox();
  const mobileSecond = await mobile[1].boundingBox();
  expect(mobileSecond!.y).toBeGreaterThan(mobileFirst!.y + 40);
  expect(Math.abs(mobileFirst!.x - mobileSecond!.x)).toBeLessThan(8);
  await openTab(page, "sugestoes");
  // The monthly card stays on top in both tabs; there is no separate "Para revisar" card.
  await expect(page.getByTestId("monthly-total")).toBeVisible();
  await expect(page.getByText("possíveis planos")).toHaveCount(0);
  const mobileSuggestions = await page.getByTestId("suggestion").all();
  const mobileSugA = await mobileSuggestions[0].boundingBox();
  const mobileSugB = await mobileSuggestions[1].boundingBox();
  expect(mobileSugB!.y).toBeGreaterThan(mobileSugA!.y + 40);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
  await openTab(page, "assinaturas");

  await page.setViewportSize({ width: 768, height: 900 });
  const tabletScreen = await page.getByTestId("screen").boundingBox();
  expect(tabletScreen!.width).toBeGreaterThan(740);
  const tablet = await page.getByTestId("plan-card").all();
  const tabletLeft = await tablet[0].boundingBox();
  const tabletRight = await tablet[1].boundingBox();
  expect(Math.abs(tabletLeft!.y - tabletRight!.y)).toBeLessThan(12);
  expect(tabletRight!.x).toBeGreaterThan(tabletLeft!.x + 200);

  await page.setViewportSize({ width: 1440, height: 900 });
  const desktopScreen = await page.getByTestId("screen").boundingBox();
  expect(desktopScreen!.width).toBeGreaterThan(1400);
  expect(desktopScreen!.x).toBeLessThan(8);
  expect(
    await page
      .locator("header.top")
      .evaluate((element) => getComputedStyle(element).position),
  ).toBe("relative");
  // Desktop: no tabs, the summary row on top, the plan list on the left and suggestions in a column on the right.
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await expect(page.getByTestId("footer-sync")).toBeVisible();
  const total = await page.getByTestId("monthly-total").boundingBox();
  const desktop = await page.getByTestId("plan-card").all();
  const first = await desktop[0].boundingBox();
  const second = await desktop[1].boundingBox();
  expect(first!.y).toBeGreaterThan(total!.y + total!.height);
  expect(second!.y).toBeGreaterThan(first!.y + 40);
  expect(Math.abs(first!.x - second!.x)).toBeLessThan(4);
  const suggestions = await page.getByTestId("suggestion").all();
  expect(suggestions).toHaveLength(2);
  const sugTop = await suggestions[0].boundingBox();
  const sugNext = await suggestions[1].boundingBox();
  expect(sugTop!.x).toBeGreaterThan(first!.x + first!.width);
  expect(sugNext!.y).toBeGreaterThan(sugTop!.y + 40);
  await expect(page.getByTestId("suggestion-peek")).toHaveCount(0);
  await page.getByTestId("remove").first().click();
  await expect(page.getByTestId("remove-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("remove-dialog")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
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

test("confirmar, remover e desfazer atualizam a lista sem recarregar", async ({
  page,
}) => {
  await routeSuggestionFlow(page);
  await page.goto("/");
  await expect(page.getByTestId("tab-sugestoes")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("tab-assinaturas")).toHaveText(
    "Assinaturas (0)",
  );
  await expect(page.getByTestId("tab-sugestoes")).toHaveText("Sugestões (2)");
  await expect(
    page.getByText("Encontramos 2 possíveis assinaturas"),
  ).toBeVisible();
  await expect(page.getByTestId("suggestion")).toHaveCount(2);
  await expect(page.getByTestId("monthly-total")).toBeVisible();

  await page
    .getByTestId("suggestion")
    .filter({ hasText: "Claude Pro" })
    .getByTestId("suggestion-yes")
    .click();
  await expect(page.getByTestId("added-toast")).toContainText(
    "Adicionado às assinaturas",
  );
  await expect(page.getByTestId("tab-sugestoes")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("tab-assinaturas")).toHaveText(
    "Assinaturas (1)",
  );
  await expect(page.getByTestId("tab-sugestoes")).toHaveText("Sugestões (1)");
  await expect(page.getByTestId("plan-card")).toHaveCount(0);
  await expect(
    page.getByTestId("suggestion").filter({ hasText: "Claude Pro" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Encontramos 1 possível assinatura"),
  ).toBeVisible();

  await page.getByTestId("added-toast-open").click();
  await expect(page).toHaveURL(/aba=assinaturas/);
  await expect(page.getByTestId("added-toast")).toBeHidden();
  await expect(page.getByTestId("plan-card")).toHaveCount(1);
  await expect(page.getByTestId("plan-name")).toHaveText("Claude Pro");
  await expect(page.getByTestId("monthly-total")).toHaveText("≈ R$ 113,85/mês");
  await expect(page.getByTestId("suggestion")).toHaveCount(0);

  await page.getByTestId("remove").click();
  await page.getByTestId("remove-confirm").click();
  await expect(page.getByTestId("undo-toast")).toBeVisible();
  await expect(page.getByTestId("undo-toast")).toContainText(
    "Plano removido do Ciclo.",
  );
  await expect(page.getByTestId("plan-card")).toHaveCount(0);
  await expect(page.getByTestId("tab-assinaturas")).toHaveText(
    "Assinaturas (0)",
  );
  await expect(page.getByTestId("tab-sugestoes")).toHaveText("Sugestões (2)");

  await openTab(page, "sugestoes");
  await expect(
    page.getByText("Encontramos 2 possíveis assinaturas"),
  ).toBeVisible();
  await expect(
    page.getByTestId("suggestion").filter({ hasText: "Claude Pro" }),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("suggestion")
      .filter({ hasText: "Claude Pro" })
      .getByTestId("suggestion-yes"),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("suggestion")
      .filter({ hasText: "Claude Pro" })
      .getByTestId("suggestion-no"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByTestId("undo-toast")).toBeHidden();
  await expect(
    page.getByTestId("suggestion").filter({ hasText: "Claude Pro" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("tab-assinaturas")).toHaveText(
    "Assinaturas (1)",
  );
  await openTab(page, "assinaturas");
  await expect(page.getByTestId("plan-card")).toHaveCount(1);
  await expect(page.getByTestId("plan-name")).toHaveText("Claude Pro");
  await expect(page.getByText("Encontramos 1 possível assinatura")).toHaveCount(
    0,
  );
});

test("o aviso de desfazer some sozinho depois de alguns segundos", async ({
  page,
}) => {
  await routeSuggestionFlow(page);
  await page.goto("/");
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

test("a aba padrão, as contagens e o total seguem o que está confirmado", async ({
  page,
}) => {
  const cards = [card({})];
  await mockPlans(page, {
    ...model(cards),
    suggestions: [suggestion("suno", "Suno Inc", "R$ 51,75/mês")],
    banners: [
      {
        id: "still:sub-1:2026-06-01",
        tone: "neutral",
        text: "Ainda cobrando: ChatGPT Plus em 01/06",
        actions: [
          {
            id: "back",
            label: "Voltar a acompanhar",
            action: "restore-charging",
            targetId: "sub-1",
          },
        ],
      },
      { id: "conn:1", tone: "red", text: "Conexão vencida.", actions: [] },
      {
        id: "suggestions",
        tone: "neutral",
        text: "Encontramos 1 possível assinatura",
        actions: [],
      },
    ],
  });
  await page.goto("/");
  await expect(
    page.getByRole("tablist", { name: "Meus planos" }),
  ).toBeVisible();
  await expect(page.getByTestId("tab-assinaturas")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("tab-assinaturas")).toHaveText(
    "Assinaturas (1)",
  );
  await expect(page.getByTestId("tab-sugestoes")).toHaveText("Sugestões (1)");
  await expect(page.getByTestId("monthly-total")).toBeVisible();
  await expect(
    page.getByText("Ainda cobrando: ChatGPT Plus em 01/06"),
  ).toBeVisible();
  await expect(page.getByTestId("connection-banner")).toContainText(
    "Conexão vencida.",
  );
  await expect(page.getByTestId("suggestion")).toHaveCount(0);

  await openTab(page, "sugestoes");
  await expect(page.getByTestId("monthly-total")).toBeVisible();
  await expect(
    page.getByText("Ainda cobrando: ChatGPT Plus em 01/06"),
  ).toHaveCount(0);
  await expect(page.getByTestId("connection-banner")).toContainText(
    "Conexão vencida.",
  );
  await expect(page.getByTestId("suggestion")).toHaveCount(1);
  await expect(page.getByTestId("plan-card")).toHaveCount(0);

  await page.unroute("**/api/plans");
  await mockPlans(page, {
    ...model([]),
    suggestions: [
      suggestion("suno", "Suno Inc", "R$ 51,75/mês"),
      suggestion("pix", "Pix recebido", "R$ 250/mês"),
    ],
    banners: [
      {
        id: "suggestions",
        tone: "neutral",
        text: "Encontramos 2 possíveis assinaturas",
        actions: [],
      },
    ],
  });
  await page.goto("/");
  await expect(page.getByTestId("tab-sugestoes")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("tab-assinaturas")).toHaveText(
    "Assinaturas (0)",
  );
  await expect(page.getByTestId("tab-sugestoes")).toHaveText("Sugestões (2)");
  await expect(page.getByTestId("monthly-total")).toBeVisible();
  await expect(page.getByTestId("empty-assinaturas")).toHaveCount(0);
});

test("a aba fica na URL, sobrevive ao reload e volta com o histórico", async ({
  page,
}) => {
  const cards = [
    card({}),
    card({ id: "sub-2", service: "claude", planName: "Claude Pro" }),
  ];
  await mockPlans(page, {
    ...model(cards),
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

  await page.goto("/?aba=sugestoes");
  await expect(page.getByTestId("tab-sugestoes")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("suggestion")).toHaveCount(1);
  await expect(page.getByTestId("plan-card")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("tab-sugestoes")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("suggestion")).toBeVisible();

  await page.goto("/?aba=assinaturas");
  await expect(page.getByTestId("tab-assinaturas")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("plan-card")).toHaveCount(2);
  await openTab(page, "sugestoes");
  await expect(page).toHaveURL(/aba=sugestoes/);
  await page.goBack();
  await expect(page).toHaveURL(/aba=assinaturas/);
  await expect(page.getByTestId("tab-assinaturas")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("plan-card")).toHaveCount(2);
  await page.goForward();
  await expect(page).toHaveURL(/aba=sugestoes/);
  await expect(page.getByTestId("tab-sugestoes")).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.getByTestId("tab-sugestoes").focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page).toHaveURL(/aba=assinaturas/);
  await expect(page.getByTestId("tab-assinaturas")).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.goto("/?aba=foo");
  await expect(page).toHaveURL(/aba=assinaturas/);
  await expect(page.getByTestId("tab-assinaturas")).toHaveAttribute(
    "aria-selected",
    "true",
  );
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
