import { expect, test } from "@playwright/test";
import { silenceSync } from "./silence-sync";

const chatgpt = {
  id: "chatgpt", service: "chatgpt", planName: "ChatGPT Plus",
  priceLabel: "≈ R$ 103,00/mês", nextChargeLabel: "Última cobrança: 19/07 · Sem cobrança recente",
  manageUrl: "https://chatgpt.com/settings/billing", manageLabel: "Gerenciar ChatGPT Plus",
  removeConfirm: "Isso não cancela sua assinatura.", autoConfirmed: false, notice: null,
};
const suggestion = {
  id: "ebanx", planName: "Ebanx", label: "3 meses seguidos", checked: false,
  priceLabel: "R$ 103,40/mês", apple: false, chargeCount: 3, logoUrl: null, logoFallback: true,
  confidence: { score: 78, label: "Média", checks: [] },
};

function screen(linked: boolean) {
  return {
    monthlyLabel: linked ? "R$ 103,40/mês" : "R$ 103,00/mês",
    annualLabel: linked ? "≈ R$ 1.240,80/ano" : "≈ R$ 1.236,00/ano",
    cards: [{ ...chatgpt, ...(linked ? { priceLabel: "R$ 103,40/mês", nextChargeLabel: "Última cobrança: 19/10" } : {}) }],
    suggestions: linked ? [] : [suggestion], banners: [], footer: "Atualizado agora", syncedAt: null,
    firstRead: false, empty: false, connections: [], appleChoices: [],
  };
}

test.beforeEach(async ({ page }) => { await silenceSync(page); });

test("vincula Ebanx ao ChatGPT Plus pelo card, sem criar outro plano no desktop", async ({ page }) => {
  let linked = false;
  let posts = 0;
  await page.route("**/api/plans", async (route) => {
    if (route.request().method() === "POST") {
      posts++;
      expect(route.request().postDataJSON()).toEqual({
        action: "link-suggestion", id: "ebanx", subscriptionId: "chatgpt",
      });
      linked = true;
    }
    await route.fulfill({ json: screen(linked) });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?aba=assinaturas");

  const button = page.getByTestId("suggestion-link-existing");
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.getByTestId("suggestion-link-form")).toContainText("3 pagamentos");
  const submit = page.getByTestId("suggestion-link-confirm");
  await expect(submit).toBeDisabled();
  await page.getByTestId("suggestion-link-target").selectOption("chatgpt");
  await submit.click();

  await expect(page.getByTestId("suggestion")).toHaveCount(0);
  await expect(page.getByTestId("plan-card")).toHaveCount(1);
  await expect(page.getByTestId("plan-card")).toContainText("19/10");
  await expect(page.getByTestId("monthly-total")).toHaveText("R$ 103,40/mês");
  expect(posts).toBe(1);
});

test("não duplica nem fecha a sugestão quando o servidor recusa o vínculo no celular", async ({ page }) => {
  let posts = 0;
  await page.route("**/api/plans", async (route) => {
    if (route.request().method() === "POST") {
      posts++;
      await route.fulfill({ status: 400, json: { error: "Pagamento já vinculado a outra assinatura." } });
      return;
    }
    await route.fulfill({ json: screen(false) });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?aba=sugestoes");
  await page.getByTestId("suggestion-link-existing").click();
  await page.getByTestId("suggestion-link-target").selectOption("chatgpt");
  await page.getByTestId("suggestion-link-confirm").click();
  await expect(page.getByTestId("suggestion-link-form").getByRole("alert")).toContainText("já vinculado");
  await expect(page.getByTestId("suggestion")).toHaveCount(1);
  await expect(page.getByTestId("plan-card")).toHaveCount(0); // hidden in suggestions tab
  expect(posts).toBe(1);
});
