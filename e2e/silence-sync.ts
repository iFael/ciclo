import type { Page } from "@playwright/test";

/** Keeps existing screens from treating an unmocked sync as a failure. */
export async function silenceSync(page: Page) {
  await page.route("**/api/sync", async (route) => {
    await route.fulfill({
      status: 429,
      json: { error: "Você pode sincronizar de novo em 2 minutos.", retryAfterSeconds: 120 },
    });
  });
}
