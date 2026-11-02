import { serviceInfo } from "@/lib/catalog";
import { inferDomains, normalizeDomain } from "@/lib/logos/infer";
import type { AppState, ServiceLogo } from "@/lib/types";

export type LogoFetch = (url: string) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  bytes(): Promise<Uint8Array>;
}>;

export type LogoCache = {
  get(merchantKey: string): Promise<ServiceLogo | null>;
  put(record: ServiceLogo): Promise<void>;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_ICON_BYTES = 400;

export function memoryLogoCache(seed?: ServiceLogo[]): LogoCache {
  const map = new Map<string, ServiceLogo>((seed ?? []).map((row) => [row.merchantKey, row]));
  return {
    async get(merchantKey) {
      return map.get(merchantKey) ?? null;
    },
    async put(record) {
      map.set(record.merchantKey, record);
    },
  };
}

export function isCacheFresh(record: ServiceLogo, now: Date): boolean {
  const resolved = new Date(record.resolvedAt).getTime();
  if (Number.isNaN(resolved)) return false;
  if (record.status === "ok") return true;
  return now.getTime() - resolved < WEEK_MS;
}

export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
  const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function looksLikeImage(bytes: Uint8Array): boolean {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return true;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return true;
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return true;
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return true;
  if (bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return true;
  return false;
}

/** Reject blank icons, tiny files, and the small default globe favicon. */
export function isUsableIcon(bytes: Uint8Array, contentType: string): boolean {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (type && !type.startsWith("image/")) return false;
  if (bytes.length < MIN_ICON_BYTES) return false;
  const png = pngSize(bytes);
  if (png && (png.width < 48 || png.height < 48)) return false;
  if (!png && !type.startsWith("image/") && !looksLikeImage(bytes)) return false;
  if (!png && !looksLikeImage(bytes) && type.startsWith("image/")) return bytes.length >= MIN_ICON_BYTES;
  return looksLikeImage(bytes) || type.startsWith("image/");
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return match ? (match[2] ?? match[3] ?? null) : null;
}

export function iconUrlsFromHtml(html: string, base: string): string[] {
  const urls: string[] = [];
  const push = (href: string | null) => {
    if (!href) return;
    try {
      const absolute = new URL(href, base).toString();
      if (!urls.includes(absolute)) urls.push(absolute);
    } catch {
      /* ignore malformed hrefs */
    }
  };
  const links = html.match(/<link\b[^>]*>/gi) ?? [];
  const apple: string[] = [];
  const icons: string[] = [];
  for (const link of links) {
    const rel = (attr(link, "rel") ?? "").toLowerCase();
    const href = attr(link, "href");
    if (!href) continue;
    if (rel.includes("apple-touch-icon")) apple.push(href);
    else if (rel === "icon" || rel.includes("icon")) icons.push(href);
  }
  for (const href of apple) push(href);
  for (const href of icons) push(href);
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const meta of metas) {
    const property = (attr(meta, "property") ?? attr(meta, "name") ?? "").toLowerCase();
    if (property === "og:image") push(attr(meta, "content"));
  }
  return urls;
}

export function manifestIconUrls(manifest: string, base: string): string[] {
  try {
    const parsed = JSON.parse(manifest) as { icons?: { src?: string; sizes?: string }[] };
    const icons = parsed.icons ?? [];
    return icons
      .map((icon) => {
        if (!icon.src) return null;
        try {
          return new URL(icon.src, base).toString();
        } catch {
          return null;
        }
      })
      .filter((url): url is string => Boolean(url));
  } catch {
    return [];
  }
}

async function safeFetch(fetchImpl: LogoFetch, url: string): Promise<Awaited<ReturnType<LogoFetch>> | null> {
  try {
    return await fetchImpl(url);
  } catch {
    return null;
  }
}

type Candidate = { url: string; source: ServiceLogo["source"] };

async function candidatesFor(domain: string, fetchImpl: LogoFetch): Promise<Candidate[]> {
  const home = `https://${domain}`;
  const list: Candidate[] = [];
  const page = await safeFetch(fetchImpl, home);
  if (page?.ok) {
    const html = await page.text();
    for (const url of iconUrlsFromHtml(html, home)) list.push({ url, source: "site" });
    const manifestHref = (html.match(/<link\b[^>]*rel=["']manifest["'][^>]*>/i) ?? [])[0];
    const href = manifestHref ? attr(manifestHref, "href") : null;
    if (href) {
      try {
        const manifestUrl = new URL(href, home).toString();
        const manifest = await safeFetch(fetchImpl, manifestUrl);
        if (manifest?.ok) {
          for (const url of manifestIconUrls(await manifest.text(), manifestUrl)) list.push({ url, source: "site" });
        }
      } catch {
        /* ignore bad manifest urls */
      }
    }
  }
  list.push({ url: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`, source: "google" });
  list.push({ url: `https://icons.duckduckgo.com/ip3/${domain}.ico`, source: "duckduckgo" });
  return list;
}

function catalogRecord(merchantKey: string, service: string, now: Date): ServiceLogo | null {
  const info = serviceInfo(service);
  if (!info?.logo || service === "unknown") return null;
  return {
    merchantKey,
    domain: info.domains[0] ?? null,
    logoUrl: info.logo,
    sourceUrl: null,
    source: "catalog",
    resolvedAt: now.toISOString(),
    status: "ok",
  };
}

export async function resolveLogo(input: {
  merchantKey: string;
  service: string;
  descriptor: string;
  domainOverride?: string | null;
  bypassCatalog?: boolean;
  now: Date;
  cache: LogoCache;
  fetchImpl: LogoFetch;
}): Promise<ServiceLogo> {
  const override = input.domainOverride ? normalizeDomain(input.domainOverride) : null;
  if (!input.bypassCatalog && !override) {
    const curated = catalogRecord(input.merchantKey, input.service, input.now);
    if (curated) return curated;
  }

  const cached = await input.cache.get(input.merchantKey);
  if (cached && isCacheFresh(cached, input.now) && (!override || cached.domain === override)) return cached;

  const domains = override ? [override] : inferDomains(input.descriptor).slice(0, 3);
  for (const domain of domains) {
    const options = await candidatesFor(domain, input.fetchImpl);
    const site = options.filter((item) => item.source === "site").slice(0, 3);
    const rest = options.filter((item) => item.source !== "site");
    for (const candidate of [...site, ...rest]) {
      const image = await safeFetch(input.fetchImpl, candidate.url);
      if (!image?.ok) continue;
      const bytes = await image.bytes();
      const type = image.headers.get("content-type") ?? "";
      if (!isUsableIcon(bytes, type)) continue;
      const record: ServiceLogo = {
        merchantKey: input.merchantKey,
        domain,
        logoUrl: `/api/logos/${encodeURIComponent(input.merchantKey)}`,
        sourceUrl: candidate.url,
        source: candidate.source === "catalog" ? "site" : candidate.source,
        resolvedAt: input.now.toISOString(),
        status: "ok",
      };
      await input.cache.put(record);
      return record;
    }
  }

  const fallback: ServiceLogo = {
    merchantKey: input.merchantKey,
    domain: override ?? domains[0] ?? null,
    logoUrl: null,
    sourceUrl: null,
    source: "fallback",
    resolvedAt: input.now.toISOString(),
    status: "fallback",
  };
  await input.cache.put(fallback);
  return fallback;
}

export async function ensureLogos(state: AppState, now: Date, cache: LogoCache, fetchImpl?: LogoFetch): Promise<Map<string, ServiceLogo>> {
  const fetch = fetchImpl ?? (await defaultFetch());
  const map = new Map<string, ServiceLogo>();
  for (const subscription of state.subscriptions) {
    if (subscription.status !== "suggested" && subscription.status !== "confirmed") continue;
    try {
      const record = await resolveLogo({
        merchantKey: subscription.merchantKey,
        service: subscription.service,
        descriptor: subscription.descriptors[0] ?? subscription.planName,
        now,
        cache,
        fetchImpl: fetch,
      });
      map.set(subscription.merchantKey, record);
    } catch {
      map.set(subscription.merchantKey, {
        merchantKey: subscription.merchantKey,
        domain: null,
        logoUrl: null,
        sourceUrl: null,
        source: "fallback",
        resolvedAt: now.toISOString(),
        status: "fallback",
      });
    }
  }
  return map;
}

async function defaultFetch(): Promise<LogoFetch> {
  return adaptFetch(globalThis.fetch.bind(globalThis));
}

export function adaptFetch(fetchImpl: typeof fetch): LogoFetch {
  return async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetchImpl(url, { redirect: "follow", signal: controller.signal });
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        ok: response.ok,
        status: response.status,
        headers: { get: (name) => response.headers.get(name) },
        text: async () => new TextDecoder().decode(bytes),
        bytes: async () => bytes,
      };
    } finally {
      clearTimeout(timer);
    }
  };
}
