import { expect, test } from "@playwright/test";
import { silenceSync } from "./silence-sync";

test.beforeEach(async ({ page }) => {
  await silenceSync(page);
});

test("mostra erro quando o e-mail é recusado, o envio falha ou a resposta não é JSON", async ({ page }) => {
  await page.route("**/api/auth/magic-link", async (route) => {
    await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "Este e-mail não pode entrar no Ciclo." }) });
  });
  await page.goto("/login");
  await page.getByTestId("login-email").fill("other@example.com");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-status")).toHaveText("Este e-mail não pode entrar no Ciclo.");

  await page.unroute("**/api/auth/magic-link");
  await page.route("**/api/auth/magic-link", async (route) => {
    await route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "Muitas tentativas. Espere um pouco e tente de novo." }) });
  });
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-status")).toHaveText("Muitas tentativas. Espere um pouco e tente de novo.");

  await page.unroute("**/api/auth/magic-link");
  await page.route("**/api/auth/magic-link", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>login</body></html>" });
  });
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-status")).toHaveText("Não foi possível enviar o link.");

  await page.unroute("**/api/auth/magic-link");
  await page.route("**/api/auth/magic-link", (route) => route.abort());
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-status")).toHaveText("Sem conexão. Tente de novo.");
});

test("depois do envio deixa digitar o código e entra", async ({ page }) => {
  await page.route("**/api/auth/magic-link", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/plans", async (route) => {
    await route.fulfill({
      json: {
        monthlyLabel: "R$ 0/mês",
        annualLabel: "≈ R$ 0/ano",
        cards: [],
        suggestions: [],
        banners: [],
        footer: "Ainda sem leitura",
        firstRead: true,
        empty: false,
        connections: [],
        appleChoices: [],
      },
    });
  });
  await page.goto("/login");
  await page.getByTestId("login-email").fill("owner@example.com");
  await page.getByTestId("login-submit").click();
  await expect(page.getByTestId("login-sent")).toHaveText("Confira seu e-mail");
  await expect(page.getByTestId("login-status")).toHaveText("Enviamos um link de acesso.");

  await page.route("**/api/auth/verify-code", async (route) => {
    const body = route.request().postDataJSON() as { token?: string };
    if (body.token !== "654321") {
      await route.fulfill({ status: 400, json: { error: "Código inválido ou expirado." } });
      return;
    }
    await route.fulfill({ json: { ok: true } });
  });
  await page.getByTestId("login-code").fill("000000");
  await page.getByTestId("login-code-submit").click();
  await expect(page.getByTestId("login-status")).toHaveText("Código inválido ou expirado.");
  await page.getByTestId("login-code").fill("654321");
  await page.getByTestId("login-code-submit").click();
  await expect(page.getByTestId("screen")).toBeVisible();
});

test("no desktop o login é um cartão e o código do e-mail aceita de 6 a 10 dígitos", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/auth/magic-link", async (route) => {
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/auth/verify-code", async (route) => {
    const body = route.request().postDataJSON() as { token?: string };
    if (body.token !== "91355226") {
      await route.fulfill({ status: 400, json: { error: "Código inválido ou expirado." } });
      return;
    }
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/plans", async (route) => {
    await route.fulfill({
      json: {
        monthlyLabel: "R$ 0/mês",
        annualLabel: "≈ R$ 0/ano",
        cards: [],
        suggestions: [],
        banners: [],
        footer: "Ainda sem leitura",
        firstRead: true,
        empty: false,
        connections: [],
        appleChoices: [],
      },
    });
  });
  await page.goto("/login");
  const sheet = page.locator("main.login-sheet");
  const box = await sheet.boundingBox();
  expect(box!.width).toBeGreaterThan(400);
  expect(box!.width).toBeLessThanOrEqual(460);
  expect(box!.x).toBeGreaterThan(400);

  await page.getByTestId("login-email").fill("owner@example.com");
  await page.getByTestId("login-submit").click();
  await expect(page.getByText("digite o código do e-mail")).toBeVisible();
  await expect(page.locator("main")).not.toContainText("6 dígitos");
  const code = page.getByTestId("login-code");
  await expect(code).toHaveAttribute("autocomplete", "one-time-code");
  await expect(code).toHaveAttribute("maxlength", "10");
  await code.fill("12345");
  await expect(page.getByTestId("login-code-submit")).toBeDisabled();
  await code.fill("123456789012345");
  await expect(code).toHaveValue("1234567890");
  await code.fill("91355226");
  await expect(page.getByTestId("login-code-submit")).toBeEnabled();
  await page.getByTestId("login-code-submit").click();
  await expect(page.getByTestId("screen")).toBeVisible();

  await page.goto("/login");
  await page.setViewportSize({ width: 390, height: 800 });
  const mobile = await page.locator("main.login-sheet").boundingBox();
  expect(mobile!.width).toBeGreaterThan(370);
  expect(mobile!.x).toBeLessThan(12);
});

test("mostra o erro de um link recusado", async ({ page }) => {
  await page.goto("/login?erro=negado");
  await expect(page.getByTestId("login-status")).toHaveText("Este e-mail não pode entrar no Ciclo.");
});
