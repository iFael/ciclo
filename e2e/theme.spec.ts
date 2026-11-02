import { expect, test } from "@playwright/test";

test("o tema escuro é o padrão e o botão de sol e lua troca para o claro e lembra", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/login");
  const html = page.locator("html");
  const toggle = page.getByTestId("theme-toggle");
  await expect(toggle).toHaveAttribute("data-theme-state", "dark");
  await expect(html).not.toHaveAttribute("data-theme", "light");
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(darkBg).toBe("rgb(11, 11, 12)");
  await page.screenshot({ path: testInfo.outputPath("login-dark.png") });

  await toggle.click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(toggle).toHaveAttribute("data-theme-state", "light");
  await expect(toggle).toHaveAccessibleName("Tema claro ativo. Mudar para o escuro");
  await page.waitForTimeout(600);
  await page.screenshot({ path: testInfo.outputPath("login-light.png") });

  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(246, 245, 242)");

  await page.getByTestId("theme-toggle").click();
  await expect(html).not.toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.getByTestId("theme-toggle")).toHaveAttribute("data-theme-state", "dark");
});
