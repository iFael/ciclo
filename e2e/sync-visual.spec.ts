import { expect, test } from "@playwright/test";

const before = {
  monthlyLabel: "R$ 110/mês",
  annualLabel: "≈ R$ 1.320/ano",
  cards: [
    {
      id: "sub-1",
      service: "chatgpt",
      planName: "ChatGPT Plus",
      priceLabel: "R$ 110/mês",
      nextChargeLabel: "Última cobrança: 19/10",
      manageUrl: "https://chatgpt.com/#settings/Subscription",
      manageLabel: "Gerenciar ChatGPT Plus no site da OpenAI, abre em nova aba",
      removeConfirm:
        "Isso não cancela sua assinatura na OpenAI. Para parar de pagar, use Gerenciar.",
      autoConfirmed: false,
      notice: null,
      logoUrl: "/logos/chatgpt.svg",
      logoFallback: false,
    },
  ],
  suggestions: [] as unknown[],
  banners: [],
  footer: "Atualizado há 2 h",
  syncedAt: new Date().toISOString(),
  firstRead: false,
  empty: false,
  connections: [
    { id: "conn-1", title: "Mercado Pago", via: "Pelo MeuPluggy", accounts: [{ id: "acc-1", kind: "card", label: "Mercado Pago", detail: "Cartão de crédito · Mastercard · final 1234" }], status: "active", statusLabel: "Ativa", expiresLabel: "01/11/2027", manageHref: "https://meu.pluggy.ai" },
  ],
  appleChoices: [],
};

const after = {
  ...before,
  suggestions: [
    {
      id: "s1",
      planName: "Netflix",
      label: "Pode ser recorrente",
      checked: false,
      priceLabel: "R$ 44,90/mês",
      apple: false,
      logoUrl: "/logos/netflix.svg",
      logoFallback: false,
    },
    {
      id: "s2",
      planName: "Spotify",
      label: "Pode ser recorrente",
      checked: false,
      priceLabel: "R$ 21,90/mês",
      apple: false,
      logoUrl: "/logos/spotify.svg",
      logoFallback: false,
    },
    {
      id: "s3",
      planName: "iCloud",
      label: "Pode ser recorrente",
      checked: false,
      priceLabel: "R$ 14,90/mês",
      apple: false,
      logoUrl: null,
      logoFallback: true,
    },
  ],
  banners: [
    {
      id: "suggestions",
      tone: "neutral",
      text: "Encontramos 3 possíveis assinaturas",
      actions: [],
    },
  ],
  footer: "Atualizado há menos de 1 h",
  syncedAt: new Date().toISOString(),
};

test("o botão e o aviso de sucesso no celular e no desktop", async ({
  page,
}, testInfo) => {
  let synced = false;
  await page.route("**/api/plans", async (route) => {
    await route.fulfill({ json: synced ? after : before });
  });
  await page.route("**/api/sync", async (route) => {
    synced = true;
    await route.fulfill({
      json: { ok: true, newSuggestions: 3, message: "3 novas sugestões" },
    });
  });

  const shots: Array<[{ width: number; height: number }, "light" | "dark"]> = [
    [{ width: 390, height: 844 }, "light"],
    [{ width: 1440, height: 900 }, "light"],
    [{ width: 390, height: 844 }, "dark"],
    [{ width: 1440, height: 900 }, "dark"],
  ];

  for (const [viewport, scheme] of shots) {
    synced = false;
    before.syncedAt = new Date(Date.now() - 20_000).toISOString();
    const size = viewport.width === 390 ? "mobile" : "desktop";
    await page.addInitScript((theme) => {
      if (theme === "light") localStorage.setItem("recontei-theme", "light");
      else localStorage.removeItem("recontei-theme");
    }, scheme);
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    await expect(page.getByTestId("footer-sync")).toHaveText(
      "Atualizado há 2 h",
    );
    // The screen has no sync button on any size: it lives in the menu, with the last update beneath it.
    await expect(page.getByTestId("sync-now")).toHaveCount(0);
    await page.getByTestId("menu").click();
    await expect(page.getByTestId("menu-sync-status")).toHaveText(
      "Atualizado há 2 h",
    );
    await page.getByTestId("menu-sync").click();
    await expect(page.getByTestId("sync-toast")).toContainText(
      "Sincronizado agora",
    );
    await expect(page.getByTestId("sync-toast")).toContainText(
      "3 novas sugestões",
    );
    await expect(page.getByTestId("footer-sync")).toHaveText(
      "Atualizado há menos de 1 h",
    );
    await page.screenshot({
      path: testInfo.outputPath(`sync-${size}-${scheme}.png`),
    });
  }
});
