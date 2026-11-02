/**
 * Versioned plan catalog. USD list prices are converted at R$ 5,50 so each
 * name band is ±15% wide. That 15% is only for the plan name. Subscription
 * grouping uses the same 15% band in lib/matching.ts.
 *
 * CATALOG_VERSION bumps when descriptors, names, or manage URLs change.
 *
 * Sources (checked 2026-11-01) for the original AI plans:
 * - ChatGPT Go $8, Plus $20, Pro 100/200/500
 * - Claude Pro $20, Max $100, Ultra $200
 * - X Subscription Plus $8, Premium $30, Super $100, Ultra $200
 */

export const CATALOG_VERSION = 2;
export const FX_REFERENCE_BRL = 5.5;

export type PlanBand = {
  name: string;
  usd: number;
  referenceBrl: number;
  minBrl: number;
  maxBrl: number;
};

export type ServiceInfo = {
  id: string;
  serviceName: string;
  company: string;
  manageUrl: string;
  cancelUrl: string;
  plans: PlanBand[];
  /** Word phrases matched against the normalized descriptor. */
  patterns: string[][];
  logo: string;
  domains: string[];
};

function band(name: string, usd: number): PlanBand {
  const referenceBrl = Math.round(usd * FX_REFERENCE_BRL * 100) / 100;
  return {
    name,
    usd,
    referenceBrl,
    minBrl: referenceBrl * 0.85,
    maxBrl: referenceBrl * 1.15,
  };
}

function brlBand(name: string, brl: number): PlanBand {
  return { name, usd: 0, referenceBrl: brl, minBrl: brl * 0.85, maxBrl: brl * 1.15 };
}

export const CATALOG: ServiceInfo[] = [
  {
    id: "chatgpt",
    serviceName: "ChatGPT",
    company: "OpenAI",
    manageUrl: "https://chatgpt.com/#settings/Subscription",
    cancelUrl: "https://help.openai.com/en/articles/7232927-canceling-your-chatgpt-subscription",
    plans: [
      band("ChatGPT Go", 8),
      band("ChatGPT Plus", 20),
      band("ChatGPT Pro 100", 100),
      band("ChatGPT Pro 200", 200),
      band("ChatGPT Pro 500", 500),
    ],
    patterns: [["OPENAI", "CHATGPT"], ["CHATGPT"]],
    logo: "/logos/chatgpt.svg",
    domains: ["chatgpt.com", "openai.com"],
  },
  {
    id: "claude",
    serviceName: "Claude",
    company: "Anthropic",
    manageUrl: "https://claude.ai/settings/billing",
    cancelUrl: "https://support.claude.com/en/articles/8325617-cancel-your-pro-or-max-subscription",
    plans: [band("Claude Pro", 20), band("Claude Max", 100), band("Claude Ultra", 200)],
    patterns: [["ANTHROPIC", "CLAUDE"], ["CLAUDE", "AI"]],
    logo: "/logos/claude.svg",
    domains: ["claude.ai", "anthropic.com"],
  },
  {
    id: "grok",
    serviceName: "Grok",
    company: "xAI",
    manageUrl: "https://grok.com/dashboard/billing",
    cancelUrl: "https://grok.com/dashboard/billing",
    plans: [band("Grok Plus", 8), band("SuperGrok", 30), band("Grok Super", 100), band("Grok Ultra", 200)],
    patterns: [["SUPERGROK"], ["GROK", "XAI"], ["GROK"]],
    logo: "/logos/grok.svg",
    domains: ["grok.com", "x.ai"],
  },
  {
    id: "netflix",
    serviceName: "Netflix",
    company: "Netflix",
    manageUrl: "https://www.netflix.com/account",
    cancelUrl: "https://www.netflix.com/cancelplan",
    plans: [brlBand("Netflix Padrão", 44.9)],
    patterns: [["NETFLIX"]],
    logo: "/logos/netflix.svg",
    domains: ["netflix.com"],
  },
  {
    id: "spotify",
    serviceName: "Spotify",
    company: "Spotify",
    manageUrl: "https://www.spotify.com/account/subscription/",
    cancelUrl: "https://www.spotify.com/account/subscription/",
    plans: [brlBand("Spotify Premium", 21.9)],
    patterns: [["SPOTIFY"]],
    logo: "/logos/spotify.svg",
    domains: ["spotify.com"],
  },
  {
    id: "youtube",
    serviceName: "YouTube Premium",
    company: "Google",
    manageUrl: "https://www.youtube.com/paid_memberships",
    cancelUrl: "https://www.youtube.com/paid_memberships",
    plans: [brlBand("YouTube Premium", 28.9)],
    patterns: [["YOUTUBE", "PREMIUM"], ["YOUTUBEPREMIUM"], ["YOUTUBE", "MEMBERSHIP"]],
    logo: "/logos/youtube.svg",
    domains: ["youtube.com"],
  },
  {
    id: "prime",
    serviceName: "Amazon Prime",
    company: "Amazon",
    manageUrl: "https://www.amazon.com.br/gp/primecentral",
    cancelUrl: "https://www.amazon.com.br/gp/primecentral",
    plans: [brlBand("Amazon Prime", 19.9)],
    patterns: [["AMAZON", "PRIME"], ["AMZN", "PRIME"], ["PRIME", "VIDEO"]],
    logo: "/logos/prime.svg",
    domains: ["amazon.com.br", "primevideo.com"],
  },
  {
    id: "disney",
    serviceName: "Disney+",
    company: "Disney",
    manageUrl: "https://www.disneyplus.com/account/subscription",
    cancelUrl: "https://www.disneyplus.com/account/subscription",
    plans: [brlBand("Disney+", 46.9)],
    patterns: [["DISNEY", "PLUS"], ["DISNEYPLUS"], ["DISNEY"]],
    logo: "/logos/disney.png",
    domains: ["disneyplus.com"],
  },
  {
    id: "max",
    serviceName: "Max",
    company: "Warner Bros. Discovery",
    manageUrl: "https://www.max.com/account",
    cancelUrl: "https://www.max.com/account",
    plans: [brlBand("Max", 34.9)],
    patterns: [["HBO", "MAX"], ["HBOMAX"], ["MAX", "COM"]],
    logo: "/logos/max.svg",
    domains: ["max.com"],
  },
  {
    id: "globoplay",
    serviceName: "Globoplay",
    company: "Globo",
    manageUrl: "https://globoplay.globo.com/configuracoes",
    cancelUrl: "https://globoplay.globo.com/configuracoes",
    plans: [brlBand("Globoplay", 27.9)],
    patterns: [["GLOBOPLAY"]],
    logo: "/logos/globoplay.png",
    domains: ["globoplay.globo.com"],
  },
  {
    id: "apple-one",
    serviceName: "Apple One",
    company: "Apple",
    manageUrl: "https://apps.apple.com/account/subscriptions",
    cancelUrl: "https://support.apple.com/pt-br/118428",
    plans: [brlBand("Apple One", 34.9), brlBand("iCloud+", 9.9)],
    patterns: [["APPLE", "ONE"], ["ICLOUD"]],
    logo: "/logos/apple-one.svg",
    domains: ["apple.com"],
  },
  {
    id: "claro-flex",
    serviceName: "Claro Flex",
    company: "Claro",
    manageUrl: "https://www.claro.com.br/flex",
    cancelUrl: "https://www.claro.com.br/flex",
    plans: [brlBand("Claro Flex", 39.9)],
    patterns: [["CLARO", "FLEX"]],
    logo: "/logos/claro-flex.png",
    domains: ["claro.com.br"],
  },
  {
    id: "suno",
    serviceName: "Suno",
    company: "Suno",
    manageUrl: "https://suno.com/account",
    cancelUrl: "https://suno.com/account",
    plans: [band("Suno Pro", 10), band("Suno Premier", 30)],
    patterns: [["SUNO"]],
    logo: "/logos/suno.svg",
    domains: ["suno.com"],
  },
  {
    id: "ifood-clube",
    serviceName: "iFood Clube",
    company: "iFood",
    manageUrl: "https://www.ifood.com.br/clube",
    cancelUrl: "https://www.ifood.com.br/clube",
    plans: [brlBand("iFood Clube", 9.9)],
    patterns: [["IFOOD", "CLUBE"]],
    logo: "/logos/ifood-clube.svg",
    domains: ["ifood.com.br"],
  },
  {
    id: "deezer",
    serviceName: "Deezer",
    company: "Deezer",
    manageUrl: "https://www.deezer.com/account/subscription",
    cancelUrl: "https://www.deezer.com/account/subscription",
    plans: [brlBand("Deezer Premium", 24.9)],
    patterns: [["DEEZER"]],
    logo: "/logos/deezer.svg",
    domains: ["deezer.com"],
  },
  {
    id: "paramount",
    serviceName: "Paramount+",
    company: "Paramount",
    manageUrl: "https://www.paramountplus.com/account/",
    cancelUrl: "https://www.paramountplus.com/account/",
    plans: [brlBand("Paramount+", 24.9)],
    patterns: [["PARAMOUNT"]],
    logo: "/logos/paramount.svg",
    domains: ["paramountplus.com"],
  },
  {
    id: "crunchyroll",
    serviceName: "Crunchyroll",
    company: "Crunchyroll",
    manageUrl: "https://www.crunchyroll.com/account/membership",
    cancelUrl: "https://www.crunchyroll.com/account/membership",
    plans: [brlBand("Crunchyroll Mega Fan", 19.9)],
    patterns: [["CRUNCHYROLL"]],
    logo: "/logos/crunchyroll.svg",
    domains: ["crunchyroll.com"],
  },
  {
    id: "microsoft-365",
    serviceName: "Microsoft 365",
    company: "Microsoft",
    manageUrl: "https://account.microsoft.com/services",
    cancelUrl: "https://account.microsoft.com/services",
    plans: [brlBand("Microsoft 365 Pessoal", 45)],
    patterns: [["MICROSOFT", "365"], ["MICROSOFT365"], ["OFFICE", "365"]],
    logo: "/logos/microsoft-365.svg",
    domains: ["microsoft.com"],
  },
  {
    id: "google-one",
    serviceName: "Google One",
    company: "Google",
    manageUrl: "https://one.google.com/settings",
    cancelUrl: "https://one.google.com/settings",
    plans: [brlBand("Google One", 9.9), brlBand("Google One", 34.9)],
    patterns: [["GOOGLE", "ONE"], ["GOOGLEONE"]],
    logo: "/logos/google-one.svg",
    domains: ["one.google.com"],
  },
  {
    id: "canva",
    serviceName: "Canva",
    company: "Canva",
    manageUrl: "https://www.canva.com/settings/billing",
    cancelUrl: "https://www.canva.com/settings/billing",
    plans: [band("Canva Pro", 15)],
    patterns: [["CANVA"]],
    logo: "/logos/canva.svg",
    domains: ["canva.com"],
  },
  {
    id: "notion",
    serviceName: "Notion",
    company: "Notion",
    manageUrl: "https://www.notion.so/profile",
    cancelUrl: "https://www.notion.so/profile",
    plans: [band("Notion Plus", 12)],
    patterns: [["NOTION"]],
    logo: "/logos/notion.svg",
    domains: ["notion.so"],
  },
  {
    id: "cursor",
    serviceName: "Cursor",
    company: "Cursor",
    manageUrl: "https://cursor.com/settings",
    cancelUrl: "https://cursor.com/settings",
    plans: [band("Cursor Pro", 20)],
    patterns: [["CURSOR"]],
    logo: "/logos/cursor.png",
    domains: ["cursor.com", "cursor.sh"],
  },
  {
    id: "apple",
    serviceName: "Assinatura via Apple",
    company: "Apple",
    manageUrl: "https://apps.apple.com/account/subscriptions",
    cancelUrl: "https://support.apple.com/pt-br/118428",
    plans: [],
    patterns: [],
    logo: "/logos/apple.svg",
    domains: ["apple.com"],
  },
];

const FOREIGN = new Set(["chatgpt", "claude", "grok", "apple", "apple-one", "suno", "canva", "notion", "cursor", "microsoft-365"]);

export const APPLE_CHOICES = ["chatgpt", "claude", "grok"].flatMap((id) => {
  const service = CATALOG.find((item) => item.id === id);
  return service ? [{ id: service.id, label: service.serviceName }] : [];
});

export function serviceInfo(id: string): ServiceInfo | undefined {
  return CATALOG.find((service) => service.id === id);
}

export function planNameFor(serviceId: string, amount: number): string {
  const service = serviceInfo(serviceId);
  if (!service) return "Assinatura";
  if (service.id === "apple") return "Assinatura via Apple";
  const hit = service.plans.find((plan) => amount >= plan.minBrl - 0.01 && amount <= plan.maxBrl + 0.01);
  return hit ? hit.name : service.serviceName;
}

export function isForeignService(serviceId: string): boolean {
  return FOREIGN.has(serviceId);
}
