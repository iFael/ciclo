/**
 * USD list prices, converted at a fixed reference of R$ 5,50 so each name band
 * is ±15% wide. That 15% is only for the plan name. Charge matching uses 2% (BRL)
 * or 10% (foreign) in lib/matching.ts.
 *
 * Sources (checked 2026-11-01):
 * - ChatGPT Go $8: https://openai.com/index/introducing-chatgpt-go/
 * - ChatGPT Plus $20: https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus
 * - ChatGPT Pro 100/200/500: https://help.openai.com/en/articles/9793128-about-chatgpt-pro-tiers
 * - Claude Pro $20/mo, Max $100, Ultra $200: https://claude.com/pricing
 * - X Subscription Plus $8, Premium $30, Super $100, Ultra $200: https://docs.x.ai/x-subscription/pricing
 *   The $30 tier is the current Premium list price and the price of existing SuperGrok plans.
 * Manage URLs were verified for this product. Cancel URLs:
 * - https://help.openai.com/en/articles/7232927-canceling-your-chatgpt-subscription
 * - https://support.claude.com/en/articles/8325617-cancel-your-pro-or-max-subscription
 * - https://grok.com/dashboard/billing (x.ai pricing: cancel from the subscription)
 * - https://support.apple.com/pt-br/118428
 */

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
  },
  {
    id: "claude",
    serviceName: "Claude",
    company: "Anthropic",
    manageUrl: "https://claude.ai/settings/billing",
    cancelUrl: "https://support.claude.com/en/articles/8325617-cancel-your-pro-or-max-subscription",
    plans: [band("Claude Pro", 20), band("Claude Max", 100), band("Claude Ultra", 200)],
  },
  {
    id: "grok",
    serviceName: "Grok",
    company: "xAI",
    manageUrl: "https://grok.com/dashboard/billing",
    cancelUrl: "https://grok.com/dashboard/billing",
    plans: [
      band("Grok Plus", 8),
      band("SuperGrok", 30),
      band("Grok Super", 100),
      band("Grok Ultra", 200),
    ],
  },
  {
    id: "apple",
    serviceName: "Assinatura via Apple",
    company: "Apple",
    manageUrl: "https://apps.apple.com/account/subscriptions",
    cancelUrl: "https://support.apple.com/pt-br/118428",
    plans: [],
  },
];

export const APPLE_CHOICES = CATALOG.filter((service) => service.id !== "apple").map((service) => ({
  id: service.id,
  label: service.serviceName,
}));

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
  return serviceId === "chatgpt" || serviceId === "claude" || serviceId === "grok" || serviceId === "apple";
}
