import { describe, expect, it } from "vitest";
import { bannerPlacement, isPlansTab, resolvePlansTab, tabLabel } from "@/lib/plans-tabs";
import { buildScreen } from "@/lib/screen";
import type { AppState, Connection, Subscription } from "@/lib/types";

describe("plans tabs", () => {
  it("opens Assinaturas when a plan is confirmed and Sugestões otherwise", () => {
    expect(resolvePlansTab(null, 0)).toBe("sugestoes");
    expect(resolvePlansTab(undefined, 0)).toBe("sugestoes");
    expect(resolvePlansTab("", 0)).toBe("sugestoes");
    expect(resolvePlansTab("outra", 0)).toBe("sugestoes");
    expect(resolvePlansTab(null, 1)).toBe("assinaturas");
    expect(resolvePlansTab("foo", 3)).toBe("assinaturas");
  });

  it("keeps an explicit tab when a suggestion is confirmed or a plan is removed", () => {
    expect(resolvePlansTab("sugestoes", 1)).toBe("sugestoes");
    expect(resolvePlansTab("sugestoes", 37)).toBe("sugestoes");
    expect(resolvePlansTab("assinaturas", 0)).toBe("assinaturas");
    expect(isPlansTab("assinaturas")).toBe(true);
    expect(isPlansTab("sugestoes")).toBe(true);
    expect(isPlansTab("assinatura")).toBe(false);
    expect(isPlansTab(null)).toBe(false);
  });

  it("puts the count in the tab label", () => {
    expect(tabLabel("assinaturas", 1)).toBe("Assinaturas (1)");
    expect(tabLabel("assinaturas", 0)).toBe("Assinaturas (0)");
    expect(tabLabel("sugestoes", 37)).toBe("Sugestões (37)");
  });

  it("sends Ainda cobrando to Assinaturas and the suggestion count to Sugestões", () => {
    const connection: Connection = {
      id: "conn-1",
      itemId: "item",
      institution: "Banco",
      connectorId: "bank",
      status: "error",
      consentExpiresAt: null,
      lastSyncedAt: "2026-11-01T13:00:00.000Z",
      lastErrorCode: "LOGIN_ERROR",
      lastSyncHadData: false,
      lastDataThrough: null,
    };
    const confirmed: Subscription = {
      id: "sub-ok",
      service: "chatgpt",
      planName: "ChatGPT Plus",
      status: "confirmed",
      dismissedAt: null,
      approximate: false,
      merchantKey: "chatgpt",
      amount: 110,
      expectedChargeDate: null,
      checked: false,
      autoConfirmed: false,
      planChangeNotice: null,
      undoStatus: null,
      suppressAutoConfirm: false,
      cancelPromptSnoozeDate: null,
      descriptors: ["OPENAI"],
      suggestionLabel: null,
    };
    const dismissed: Subscription = {
      ...confirmed,
      id: "sub-gone",
      status: "dismissed",
      dismissedAt: "2026-05-01T12:00:00.000Z",
    };
    const suggested: Subscription = {
      ...confirmed,
      id: "sub-maybe",
      planName: "Suno Inc",
      status: "suggested",
      amount: 51.75,
      suggestionLabel: "Pode ser recorrente",
    };
    const state: AppState = {
      connections: [connection],
      subscriptions: [confirmed, dismissed, suggested],
      charges: [
        {
          subscriptionId: "sub-gone",
          chargeDate: "2026-06-01",
          amount: 110,
          transactionId: "tx-new",
          resolved: false,
        },
      ],
      ignoredDescriptors: [],
    };
    const banners = buildScreen(state, new Date("2026-11-01T15:00:00.000Z")).banners;
    expect(banners.filter((banner) => bannerPlacement(banner.id) === "plan").map((banner) => banner.text)).toEqual([
      "Ainda cobrando: ChatGPT Plus em 01/06",
    ]);
    expect(banners.filter((banner) => bannerPlacement(banner.id) === "suggestions").map((banner) => banner.text)).toEqual([
      "Encontramos 1 possível assinatura",
    ]);
    expect(banners.some((banner) => bannerPlacement(banner.id) === "connection" && banner.text.includes("erro"))).toBe(true);
    expect(banners.every((banner) => bannerPlacement(banner.id) !== "plan" || banner.id.startsWith("still:") || banner.id.startsWith("cancel:"))).toBe(true);
  });
});
