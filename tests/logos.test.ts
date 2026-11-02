import { describe, expect, it } from "vitest";
import { mergeDetections } from "@/lib/actions";
import { cleanMerchantName, inferDomains, normalizeDomain } from "@/lib/logos/infer";
import {
  ensureLogos,
  iconUrlsFromHtml,
  isCacheFresh,
  isUsableIcon,
  memoryLogoCache,
  resolveLogo,
  type LogoFetch,
} from "@/lib/logos/resolve";
import { detect } from "@/lib/matching";
import { prepareScreen } from "@/lib/present";
import { emptyState } from "@/lib/store";
import type { ServiceLogo } from "@/lib/types";

const NOW = new Date("2026-11-01T15:00:00.000Z");

function png(width: number, height: number, bytes = 800): Uint8Array {
  const data = new Uint8Array(bytes);
  data[0] = 0x89;
  data[1] = 0x50;
  data[2] = 0x4e;
  data[3] = 0x47;
  data[16] = (width >>> 24) & 255;
  data[17] = (width >>> 16) & 255;
  data[18] = (width >>> 8) & 255;
  data[19] = width & 255;
  data[20] = (height >>> 24) & 255;
  data[21] = (height >>> 16) & 255;
  data[22] = (height >>> 8) & 255;
  data[23] = height & 255;
  return data;
}

function body(payload: string | Uint8Array, type: string, ok = true) {
  const bytes = typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  return {
    ok,
    status: ok ? 200 : 404,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? type : null) },
    text: async () => new TextDecoder().decode(bytes),
    bytes: async () => bytes,
  };
}

describe("logo icons", () => {
  it("rejects tiny and default-sized icons and accepts a real image", () => {
    expect(isUsableIcon(png(16, 16, 500), "image/png")).toBe(false);
    expect(isUsableIcon(png(64, 64, 120), "image/png")).toBe(false);
    expect(isUsableIcon(png(64, 64, 800), "image/png")).toBe(true);
    expect(isUsableIcon(png(64, 64, 800), "text/html")).toBe(false);
  });

  it("reads apple-touch-icon, manifest and og:image in that order", () => {
    const html = `<link rel="apple-touch-icon" href="/apple.png"><link rel="manifest" href="/manifest.json"><meta property="og:image" content="https://cdn.example/og.png">`;
    expect(iconUrlsFromHtml(html, "https://suno.com")).toEqual(["https://suno.com/apple.png", "https://cdn.example/og.png"]);
  });
});

describe("domain inference", () => {
  it("cleans processor noise and reads a domain from the descriptor", () => {
    expect(cleanMerchantName("PAG*SUNO SAO PAULO")).toBe("SUNO");
    expect(inferDomains("SUNO.COM")).toEqual(["suno.com"]);
    expect(inferDomains("CURSOR.SH")).toContain("cursor.sh");
    expect(inferDomains("PAG*SUNO")).toEqual(["suno.com", "suno.com.br"]);
    expect(normalizeDomain("https://www.Suno.com/account")).toBe("suno.com");
    expect(normalizeDomain("not a domain")).toBeNull();
  });
});

describe("logo resolution", () => {
  it("tries the site icon before a favicon service and skips a default globe", async () => {
    const calls: string[] = [];
    const fetchImpl: LogoFetch = async (url) => {
      calls.push(url);
      if (url === "https://suno.com") {
        return body(`<link rel="apple-touch-icon" href="/a.png"><meta property="og:image" content="https://cdn.suno.com/og.png">`, "text/html");
      }
      if (url.endsWith("/a.png")) return body(png(16, 16, 600), "image/png");
      if (url.includes("og.png")) return body(png(128, 128, 900), "image/png");
      throw new Error(`unexpected ${url}`);
    };
    const record = await resolveLogo({
      merchantKey: "unknown:SUNO:5990",
      service: "unknown",
      descriptor: "SUNO.COM",
      now: NOW,
      cache: memoryLogoCache(),
      fetchImpl,
    });
    expect(record.status).toBe("ok");
    expect(record.source).toBe("site");
    expect(record.sourceUrl).toBe("https://cdn.suno.com/og.png");
    expect(record.logoUrl).toBe("/api/logos/unknown%3ASUNO%3A5990");
    expect(calls.some((url) => url.includes("google.com") || url.includes("duckduckgo"))).toBe(false);
  });

  it("falls through a default favicon to the next service", async () => {
    const fetchImpl: LogoFetch = async (url) => {
      if (url === "https://academiafit.com") return body("no icons", "text/html");
      if (url.includes("google.com")) return body(png(16, 16, 500), "image/png");
      if (url.includes("duckduckgo")) return body(png(64, 64, 900), "image/png");
      return body("", "text/plain", false);
    };
    const record = await resolveLogo({
      merchantKey: "unknown:ACADEMIA FIT:8000",
      service: "unknown",
      descriptor: "ACADEMIA FIT",
      now: NOW,
      cache: memoryLogoCache(),
      fetchImpl,
    });
    expect(record.source).toBe("duckduckgo");
    expect(record.status).toBe("ok");
  });

  it("uses a fresh cache and retries a failed lookup after a week", async () => {
    let calls = 0;
    const fetchImpl: LogoFetch = async () => {
      calls += 1;
      return body("", "text/plain", false);
    };
    const cache = memoryLogoCache();
    const first = await resolveLogo({
      merchantKey: "unknown:ACADEMIA FIT:8000",
      service: "unknown",
      descriptor: "ACADEMIA FIT",
      now: NOW,
      cache,
      fetchImpl,
    });
    expect(first.status).toBe("fallback");
    const again = await resolveLogo({
      merchantKey: "unknown:ACADEMIA FIT:8000",
      service: "unknown",
      descriptor: "ACADEMIA FIT",
      now: new Date("2026-11-02T15:00:00.000Z"),
      cache,
      fetchImpl,
    });
    expect(again.status).toBe("fallback");
    expect(calls).toBeGreaterThan(0);
    const callsAfterCache = calls;
    await resolveLogo({
      merchantKey: "unknown:ACADEMIA FIT:8000",
      service: "unknown",
      descriptor: "ACADEMIA FIT",
      now: new Date("2026-11-03T15:00:00.000Z"),
      cache,
      fetchImpl,
    });
    expect(calls).toBe(callsAfterCache);
    expect(isCacheFresh({ ...first, resolvedAt: "2026-10-20T00:00:00.000Z" }, NOW)).toBe(false);
  });

  it("keeps a catalog logo without a network call", async () => {
    const fetchImpl: LogoFetch = async () => {
      throw new Error("catalog should not fetch");
    };
    const record = await resolveLogo({
      merchantKey: "grok",
      service: "grok",
      descriptor: "SUPERGROK",
      now: NOW,
      cache: memoryLogoCache(),
      fetchImpl,
    });
    expect(record.logoUrl).toBe("/logos/grok.svg");
    expect(record.source).toBe("catalog");
    expect(record.status).toBe("ok");
  });
});

describe("suggestions already have a logo", () => {
  it("fills logo_url or the fallback flag before the screen is returned", async () => {
    const dates = ["2026-08-12", "2026-09-12", "2026-10-12"];
    const known = detect(
      dates.map((chargeDate, index) => ({ id: `g${index}`, description: "SUPERGROK", amount: 165, chargeDate })),
      [],
      "2026-11-01",
    );
    const unknown = detect(
      dates.map((chargeDate, index) => ({ id: `a${index}`, description: "ACADEMIA FIT", amount: 80, chargeDate })),
      [],
      "2026-11-01",
    );
    const state = mergeDetections(mergeDetections(emptyState(), known, true), unknown, true);
    const fetchImpl: LogoFetch = async () => body("", "text/plain", false);
    const screen = await prepareScreen(state, NOW, memoryLogoCache(), fetchImpl);
    expect(screen.suggestions.length).toBeGreaterThan(0);
    for (const suggestion of screen.suggestions) {
      expect(suggestion.logoUrl || suggestion.logoFallback).toBeTruthy();
    }
    const grok = screen.suggestions.find((item) => item.planName === "SuperGrok");
    const academia = screen.suggestions.find((item) => item.planName.startsWith("Academia"));
    expect(grok?.logoUrl).toBe("/logos/grok.svg");
    expect(grok?.logoFallback).toBe(false);
    expect(academia?.logoUrl).toBeNull();
    expect(academia?.logoFallback).toBe(true);
    const logos = await ensureLogos(state, NOW, memoryLogoCache(), fetchImpl);
    expect(logos.get("grok")?.status).toBe("ok");
    expect((logos.get(academia ? "pending" : "") ?? { status: "fallback" }).status).toBe("fallback");
  });

  it("reuses a cached logo for an unknown merchant", async () => {
    const cached: ServiceLogo = {
      merchantKey: "unknown:ACADEMIA FIT:8000",
      domain: "academiafit.com",
      logoUrl: "/api/logos/unknown%3AACADEMIA%20FIT%3A8000",
      sourceUrl: "https://academiafit.com/icon.png",
      source: "site",
      resolvedAt: NOW.toISOString(),
      status: "ok",
    };
    let calls = 0;
    const fetchImpl: LogoFetch = async () => {
      calls += 1;
      return body("", "text/plain", false);
    };
    const record = await resolveLogo({
      merchantKey: cached.merchantKey,
      service: "unknown",
      descriptor: "ACADEMIA FIT",
      now: NOW,
      cache: memoryLogoCache([cached]),
      fetchImpl,
    });
    expect(record.logoUrl).toBe(cached.logoUrl);
    expect(calls).toBe(0);
  });
});
