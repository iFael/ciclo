import { expect, test } from "@playwright/test";

const plans = {
  monthlyLabel: "R$ 110,00/mês",
  annualLabel: "≈ R$ 1.320,00/ano",
  cards: [
    {
      id: "sub-1",
      service: "chatgpt",
      planName: "ChatGPT Plus",
      priceLabel: "R$ 110,00/mês",
      nextChargeLabel: "Última cobrança: 19/10",
      manageUrl: "https://chatgpt.com/#settings/Subscription",
      manageLabel: "Gerenciar ChatGPT Plus no site da OpenAI, abre em nova aba",
      removeConfirm: "Isso não cancela sua assinatura na OpenAI. Para parar de pagar, use Gerenciar.",
      autoConfirmed: false,
      notice: null,
      logoUrl: "/logos/chatgpt.svg",
      logoFallback: false,
    },
  ],
  suggestions: [],
  banners: [],
  footer: "Atualizado há 2 h",
  syncedAt: new Date().toISOString(),
  firstRead: false,
  empty: false,
  connections: [],
  appleChoices: [],
};

test("o menu envia o resumo semanal por e-mail", async ({ page }, testInfo) => {
  let calls = 0;
  await page.route("**/api/plans", (route) => route.fulfill({ json: plans }));
  await page.route("**/api/sync", (route) => route.fulfill({ json: { ok: true, newSuggestions: 0, message: "" } }));
  await page.route("**/api/summary", async (route) => {
    calls += 1;
    if (calls === 1) await route.fulfill({ json: { ok: true } });
    else await route.fulfill({ status: 429, json: { error: "O resumo acabou de ser enviado. Espere um minuto para mandar de novo." } });
  });
  await page.goto("/");
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await expect(page.getByTestId("footer-sync")).toBeAttached();

  await page.getByTestId("menu").click();
  await expect(page.getByTestId("menu-summary")).toHaveText("Enviar resumo por e-mail");
  await page.screenshot({ path: testInfo.outputPath("menu.png") });
  await page.getByTestId("menu-summary").click();
  await expect(page.getByTestId("sync-toast")).toContainText("Resumo enviado");
  await page.screenshot({ path: testInfo.outputPath("toast.png") });

  // The menu closes with an animation; open it again only once it is gone, or the click lands on the closing menu.
  await expect(page.getByTestId("menu-summary")).toHaveCount(0);
  await page.getByTestId("menu").click();
  await expect(page.getByTestId("menu-summary")).toBeVisible();
  await page.getByTestId("menu-summary").click();
  await expect(page.getByTestId("sync-error")).toContainText("Espere um minuto");
  expect(calls).toBe(2);
});
