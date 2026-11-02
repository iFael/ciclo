/**
 * Service catalog. The data lives in the `catalog_services` table (see
 * supabase/migrations/20261102160000_catalog_table.sql), not in the code:
 * adding a service or a new statement spelling is a row edit, not a deploy.
 *
 * The catalog only names things (logo, plan name, manage link) and lets a
 * known service be suggested from a single recent charge. Detection itself
 * works for any merchant through recurrence, and plans the user confirms
 * become known merchants on their own (lib/matching.ts `knownMerchants`).
 *
 * Plan names cover ±15% around the reference price in reais.
 */

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
  foreign: boolean;
};

/** One row as stored. Plans carry only a name and a reference price. */
export type CatalogRow = {
  id: string;
  serviceName: string;
  company: string;
  manageUrl?: string;
  cancelUrl?: string;
  plans?: { name: string; brl: number; usd?: number }[];
  patterns?: string[][];
  logo?: string;
  domains?: string[];
  foreign?: boolean;
};

function toBand(plan: { name: string; brl: number; usd?: number }): PlanBand {
  return { name: plan.name, usd: plan.usd ?? 0, referenceBrl: plan.brl, minBrl: plan.brl * 0.85, maxBrl: plan.brl * 1.15 };
}

function cleanPatterns(patterns: unknown): string[][] {
  if (!Array.isArray(patterns)) return [];
  return patterns
    .filter((phrase): phrase is unknown[] => Array.isArray(phrase))
    .map((phrase) => phrase.filter((word): word is string => typeof word === "string" && word.trim() !== "").map((word) => word.trim().toUpperCase()))
    .filter((phrase) => phrase.length > 0);
}

export function serviceFromRow(row: CatalogRow): ServiceInfo {
  return {
    id: row.id,
    serviceName: row.serviceName,
    company: row.company,
    manageUrl: row.manageUrl ?? "",
    cancelUrl: row.cancelUrl ?? "",
    plans: (row.plans ?? []).filter((plan) => plan && typeof plan.brl === "number" && plan.name).map(toBand),
    patterns: cleanPatterns(row.patterns),
    logo: row.logo ?? "",
    domains: Array.isArray(row.domains) ? row.domains : [],
    foreign: Boolean(row.foreign),
  };
}

let registry: ServiceInfo[] = [];

/** Replace the catalog for this process. Called whenever the store loads. */
export function setCatalog(rows: CatalogRow[]): void {
  registry = rows.map(serviceFromRow);
}

export function catalog(): ServiceInfo[] {
  return registry;
}

const APPLE_CHOICE_IDS = ["chatgpt", "claude", "grok"];

export function appleChoices(): { id: string; label: string }[] {
  return APPLE_CHOICE_IDS.flatMap((id) => {
    const service = serviceInfo(id);
    return service ? [{ id: service.id, label: service.serviceName }] : [];
  });
}

export function serviceInfo(id: string): ServiceInfo | undefined {
  return registry.find((service) => service.id === id);
}

export function planNameFor(serviceId: string, amount: number): string {
  const service = serviceInfo(serviceId);
  if (!service) return "Assinatura";
  if (service.id === "apple") return "Assinatura via Apple";
  const hit = service.plans.find((plan) => amount >= plan.minBrl - 0.01 && amount <= plan.maxBrl + 0.01);
  return hit ? hit.name : service.serviceName;
}

export function isForeignService(serviceId: string): boolean {
  return Boolean(serviceInfo(serviceId)?.foreign);
}
