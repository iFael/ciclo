import { expect, test, type Page, type Route } from "@playwright/test";

type Payload = ReturnType<typeof plans>;

function plans(partial: { footer?: string; syncedAt?: string | null; suggestions?: number } = {}) {
  const count = partial.suggestions ?? 0;
  const suggestions = Array.from({ length: count }, (_, index) => ({
    id: `s${index}`,
    planName: `Serviço ${index + 1}`,
    label: "Pode ser recorrente",
    checked: false,
    priceLabel: "R$ 10/mês",
    apple: false,
  }));
  return {
    monthlyLabel: "R$ 110/mês",
    annualLabel: "≈ R$ 1.320/ano",
    cards: [
      {
        id: "sub-1",
        service: "chatgpt",
        planName: "ChatGPT Plus",
        priceLabel: "R$ 110/mês",
        nextChargeLabel: "Última cobrança: 19/10",
        manageUrl: null,
        manageLabel: "Gerenciar",
        removeConfirm: "Remover",
        autoConfirmed: false,
        notice: null,
      },
    ],
    suggestions,
    banners: count > 0 ? [{ id: "suggestions", tone: "neutral", text: `Encontramos ${count} possíveis assinaturas`, actions: [] }] : [],
    footer: partial.footer ?? "Atualizado há 2 h",
    syncedAt: partial.syncedAt === undefined ? new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() : partial.syncedAt,
    firstRead: false,
    empty: false,
    connections: [],
    appleChoices: [],
  };
}

async function mockPlans(page: Page, current: () => Payload) {
  await page.route("**/api/plans", async (route) => {
    await route.fulfill({ json: current() });
  });
}

async function countSync(page: Page, fulfill: (route: Route) => Promise<void>) {
  let calls = 0;
  await page.route("**/api/sync", async (route) => {
    calls += 1;
    await fulfill(route);
  });
  return {
    get count() {
      return calls;
    },
  };
}

async function armVisibility(page: Page) {
  await page.addInitScript(() => {
    let state = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => state === "hidden" });
    (window as unknown as { __setVis: (next: string, shiftMs?: number) => void }).__setVis = (next, shiftMs = 0) => {
      const real = Date.now;
      if (shiftMs) Date.now = () => real() + shiftMs;
      state = next;
      document.dispatchEvent(new Event("visibilitychange"));
      Date.now = real;
    };
  });
}

test("a sincronização automática dispara ao abrir e avisa só quando há sugestão nova", async ({ page }) => {
  let payload = plans({ suggestions: 0, footer: "Atualizado há 3 h" });
  await mockPlans(page, () => payload);
  const sync = await countSync(page, async (route) => {
    payload = plans({ suggestions: 3, footer: "Atualizado há menos de 1 h", syncedAt: new Date().toISOString() });
    await route.fulfill({ json: { ok: true, newSuggestions: 3, message: "3 novas sugestões" } });
  });
  await page.goto("/");
  await expect.poll(() => sync.count).toBe(1);
  await expect(page.getByTestId("sync-toast")).toContainText("Sincronizado agora");
  await expect(page.getByTestId("sync-toast")).toContainText("3 novas sugestões");
  await expect(page.getByTestId("tab-sugestoes")).toHaveText("Sugestões (3)");
  await expect(page.getByTestId("footer-sync")).toHaveText("Atualizado há menos de 1 h");
  expect(sync.count).toBe(1);
});

test("não chama a sincronização nem mostra aviso quando a última leitura é recente", async ({ page }) => {
  const payload = plans({
    footer: "Atualizado há menos de 1 h",
    syncedAt: new Date(Date.now() - 30_000).toISOString(),
  });
  await mockPlans(page, () => payload);
  const sync = await countSync(page, async (route) => {
    await route.fulfill({ json: { ok: true, newSuggestions: 1, message: "1 nova sugestão" } });
  });
  await page.goto("/");
  await expect(page.getByTestId("footer-sync")).toHaveText("Atualizado há menos de 1 h");
  await expect(page.getByTestId("sync-now")).toBeEnabled();
  await page.waitForTimeout(400);
  expect(sync.count).toBe(0);
  await expect(page.getByTestId("sync-toast")).toHaveCount(0);
  await expect(page.getByTestId("sync-error")).toHaveCount(0);
});

test("sincroniza ao voltar para o app depois de ficar escondido", async ({ page }) => {
  await armVisibility(page);
  const payload = plans({
    footer: "Atualizado há menos de 1 h",
    syncedAt: new Date(Date.now() - 30_000).toISOString(),
  });
  await mockPlans(page, () => payload);
  const sync = await countSync(page, async (route) => {
    await route.fulfill({ json: { ok: true, newSuggestions: 0, message: "Nada novo" } });
  });
  await page.goto("/");
  await expect(page.getByTestId("footer-sync")).toBeVisible();
  await page.waitForTimeout(300);
  expect(sync.count).toBe(0);

  await page.evaluate(() => {
    const setVis = (window as unknown as { __setVis: (next: string, shiftMs?: number) => void }).__setVis;
    setVis("hidden");
    setVis("visible", 3 * 60 * 1000);
  });
  await expect.poll(() => sync.count).toBe(1);
  await expect(page.getByTestId("sync-toast")).toHaveCount(0);
});

test("não dispara duas sincronizações ao mesmo tempo", async ({ page }) => {
  await armVisibility(page);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mockPlans(page, () => plans({ footer: "Atualizado há 3 h" }));
  const sync = await countSync(page, async (route) => {
    await gate;
    await route.fulfill({ json: { ok: true, newSuggestions: 0, message: "Nada novo" } });
  });
  await page.goto("/");
  await expect.poll(() => sync.count).toBe(1);
  await expect(page.getByTestId("sync-now")).toBeDisabled();
  await expect(page.getByTestId("footer-sync")).toHaveText("Sincronizando…");
  await page.evaluate(() => {
    const setVis = (window as unknown as { __setVis: (next: string, shiftMs?: number) => void }).__setVis;
    setVis("hidden");
    setVis("visible", 5 * 60 * 1000);
  });
  await page.waitForTimeout(250);
  expect(sync.count).toBe(1);
  release();
  await expect(page.getByTestId("sync-now")).toBeEnabled();
  expect(sync.count).toBe(1);
});

test("sincronizar agora mostra o aviso e atualiza os planos sem recarregar", async ({ page }) => {
  let payload = plans({
    suggestions: 0,
    footer: "Atualizado há 2 h",
    syncedAt: new Date(Date.now() - 20_000).toISOString(),
  });
  await mockPlans(page, () => payload);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const sync = await countSync(page, async (route) => {
    payload = plans({
      suggestions: 3,
      footer: "Atualizado há menos de 1 h",
      syncedAt: new Date().toISOString(),
    });
    await gate;
    await route.fulfill({ json: { ok: true, newSuggestions: 3, message: "3 novas sugestões" } });
  });
  await page.goto("/");
  await expect(page.getByTestId("footer-sync")).toHaveText("Atualizado há 2 h");
  expect(sync.count).toBe(0);
  await page.evaluate(() => {
    (window as unknown as { __kept?: number }).__kept = 1;
  });
  await page.getByTestId("menu").click();
  await expect(page.getByTestId("menu-sync")).toHaveText("Sincronizar agora");
  await page.keyboard.press("Escape");
  await page.getByTestId("sync-now").click();
  await expect(page.getByTestId("footer-sync")).toHaveText("Sincronizando…");
  await expect(page.getByTestId("sync-now")).toBeDisabled();
  release();
  await expect(page.getByTestId("sync-toast")).toContainText("Sincronizado agora");
  await expect(page.getByTestId("sync-toast")).toContainText("3 novas sugestões");
  await expect(page.getByTestId("tab-sugestoes")).toHaveText("Sugestões (3)");
  await expect(page.getByTestId("footer-sync")).toHaveText("Atualizado há menos de 1 h");
  expect(await page.evaluate(() => (window as unknown as { __kept?: number }).__kept)).toBe(1);
  expect(sync.count).toBe(1);
});

test("mostra um aviso de erro em português quando a sincronização falha", async ({ page }) => {
  await mockPlans(page, () =>
    plans({
      footer: "Atualizado há 2 h",
      syncedAt: new Date(Date.now() - 20_000).toISOString(),
    }),
  );
  await countSync(page, async (route) => {
    await route.fulfill({ status: 500, json: { error: "falhou" } });
  });
  await page.goto("/");
  await page.getByTestId("sync-now").click();
  await expect(page.getByTestId("sync-error")).toHaveText("Não foi possível sincronizar agora.");
  await expect(page.getByTestId("sync-toast")).toHaveCount(0);
});

test("explica quanto tempo falta quando a sincronização manual vem cedo demais", async ({ page }) => {
  await mockPlans(page, () =>
    plans({
      footer: "Atualizado há menos de 1 h",
      syncedAt: new Date(Date.now() - 20_000).toISOString(),
    }),
  );
  await countSync(page, async (route) => {
    await route.fulfill({
      status: 429,
      json: { error: "Você pode sincronizar de novo em 1 min 30 s.", retryAfterSeconds: 90 },
    });
  });
  await page.goto("/");
  await page.getByTestId("sync-now").click();
  await expect(page.getByTestId("sync-toast")).toContainText("Você pode sincronizar de novo em 1 min 30 s.");
  await expect(page.getByTestId("sync-toast")).not.toContainText("Sincronizado agora");
  await expect(page.getByTestId("sync-error")).toHaveCount(0);
});
