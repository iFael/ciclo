import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

describe("pwa", () => {
  it("publishes a standalone branded manifest with maskable icons", () => {
    const web = manifest();
    expect(web.name).toBe("Recontei App");
    expect(web.short_name).toBe("Recontei");
    expect(web.display).toBe("standalone");
    expect(web.start_url).toBe("/");
    expect(web.background_color).toBe("#0d0d0f");
    expect(web.theme_color).toBe("#0d0d0f");
    const icons = web.icons ?? [];
    expect(icons.some((icon) => icon.sizes === "192x192" && icon.purpose === "maskable")).toBe(true);
    expect(icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable")).toBe(true);
  });

  it("uses the service worker only as an offline fallback", () => {
    const source = readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");
    expect(source).toContain('"/offline.html"');
    expect(source).toContain("recontei-offline-v2");
    expect(source).toContain('startsWith("/api/")');
    expect(source).toContain('startsWith("/auth/")');
    expect(source).not.toContain("cache.put");
    expect(source).not.toContain("caches.put");
  });
});
