import { expect, test } from "@playwright/test";
import { silenceSync } from "./silence-sync";

const payload = {
  monthlyLabel: "R$ 0/mês",
  annualLabel: "≈ R$ 0/ano",
  cards: [],
  suggestions: [],
  banners: [],
  footer: "Atualizado há 1 h",
  firstRead: false,
  empty: true,
  connections: [
    {
      id: "conn-1",
      title: "Mercado Pago",
      via: "Pelo MeuPluggy",
      accounts: [
        { id: "a1", kind: "card", label: "Mercado Pago", detail: "Cartão de crédito · Mastercard · final 1234" },
        { id: "a2", kind: "account", label: "Conta Mercado Pago", detail: "Conta" },
      ],
      status: "active",
      statusLabel: "Ativa",
      expiresLabel: "01/11/2027",
      manageHref: "https://meu.pluggy.ai",
    },
    {
      id: "conn-2",
      title: "Nubank",
      via: "Pelo MeuPluggy",
      accounts: [{ id: "a3", kind: "card", label: "Nubank Ultravioleta", detail: "Cartão de crédito · Mastercard · final 9876" }],
      status: "expired",
      statusLabel: "Vencida",
      expiresLabel: "20/10/2026",
      manageHref: "https://meu.pluggy.ai",
    },
  ],
  appleChoices: [],
};

test("Conexões mostra o banco e os cartões reais e permite conectar outro", async ({ page }, testInfo) => {
  await silenceSync(page);
  await page.context().route("https://meu.pluggy.ai/**", (route) => route.fulfill({ contentType: "text/html", body: "<p>MeuPluggy</p>" }));
  let popup = { url: () => "" };
  page.context().on("page", (opened) => {
    popup = opened;
  });
  await page.route("**/api/plans", (route) => route.fulfill({ json: payload }));
  const removed = { ...payload, connections: payload.connections.slice(0, 1) };
  await page.route("**/api/connections", (route) => route.fulfill({ json: { ok: true, screen: removed } }));

  for (const [viewport, scheme] of [
    [{ width: 390, height: 844 }, "light"],
    [{ width: 1440, height: 900 }, "dark"],
  ] as const) {
    await page.addInitScript((theme) => {
      if (theme === "light") localStorage.setItem("ciclo-theme", "light");
      else localStorage.removeItem("ciclo-theme");
    }, scheme);
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize(viewport);
    await page.goto("/?aba=assinaturas");
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.getByTestId("menu").click();
    await page.getByTestId("menu-connections").click();
    const dialog = page.getByTestId("connections-dialog");
    await expect(dialog.getByTestId("connection-row")).toHaveCount(2);
    await expect(dialog).toContainText("final 1234");
    await expect(dialog.getByTestId("connect-bank")).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: testInfo.outputPath(`${viewport.width === 390 ? "mobile" : "desktop"}-${scheme}-conexoes.png`) });
  }

  await page.getByTestId("connect-bank").click();
  await expect(page.getByTestId("add-bank-waiting")).toBeVisible();
  await expect.poll(() => popup.url()).toContain("meu.pluggy.ai/connections");
  await page.waitForTimeout(300);
  await page.screenshot({ path: testInfo.outputPath("conectar-banco.png") });
  await page.getByRole("button", { name: "Cancelar" }).click();

  await page.getByRole("button", { name: "Remover Nubank" }).click();
  await page.getByRole("button", { name: "Remover", exact: true }).click();
  await expect(page.getByTestId("connections-dialog").getByTestId("connection-row")).toHaveCount(1);
});
