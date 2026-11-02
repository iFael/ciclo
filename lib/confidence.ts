/**
 * Confidence score for a possible subscription. Deterministic, 0–100.
 *
 * Weights — recent activity and the length of the streak weigh the most,
 * because those are what make a charge look like an active subscription.
 * The other checks break ties:
 *
 * - Cobrança recente:          30 if the last charge is inside the grace window, else 0
 * - Cobrado nos últimos meses: 12 for 2 months, 18 for 3, +6 for each month
 *                              past 3, capped at 30; 0 for a single charge
 * - Valor estável:             15 if every amount in the group is within 15%
 * - Dias do mês parecidos:     15 if every charge falls within ±5 days of the median day
 *                              (not required to suggest)
 * - Serviço conhecido:         10 if the descriptor matches the catalog
 *
 * A passing annual pair (2 charges) scores the 18-point base of a 3-month streak.
 *
 * Learning (lib/learning.ts) then adds +15 when the charge looks like plans the
 * user confirmed, or −25 when it looks like ones they refused. The final score
 * is clamped to 0–100.
 *
 * Labels: 80–100 Alta chance, 55–79 Média, 0–54 Baixa.
 * Suggestions are sorted by this score, highest first.
 */

export const CONFIDENCE_WEIGHTS = {
  recent: 30,
  streakPair: 12,
  streakBase: 18,
  streakStep: 6,
  streakCap: 30,
  amount: 15,
  day: 15,
  catalog: 10,
} as const;

export const CHECK_LABELS = {
  streak: "Cobrado nos últimos meses",
  day: "Dias do mês parecidos",
  amount: "Valor estável",
  catalog: "Serviço conhecido",
  recent: "Cobrança recente",
  learned: "Suas escolhas",
} as const;

export type ConfidenceCheckId = keyof typeof CHECK_LABELS;

export type ConfidenceCheck = {
  id: ConfidenceCheckId;
  label: string;
  detail: string;
  passed: boolean;
  points: number;
};

export type ConfidenceLabel = "Alta chance" | "Média" | "Baixa";

export type Confidence = {
  score: number;
  label: ConfidenceLabel;
  checks: ConfidenceCheck[];
};

export function confidenceLabel(score: number): ConfidenceLabel {
  if (score >= 80) return "Alta chance";
  if (score >= 55) return "Média";
  return "Baixa";
}

export function streakPoints(occurrences: number, passed: boolean, cadence: "monthly" | "annual" = "monthly"): number {
  if (!passed || occurrences < 2) return 0;
  if (cadence === "annual") return CONFIDENCE_WEIGHTS.streakBase;
  if (occurrences === 2) return CONFIDENCE_WEIGHTS.streakPair;
  const extra = Math.max(0, occurrences - 3);
  return Math.min(CONFIDENCE_WEIGHTS.streakCap, CONFIDENCE_WEIGHTS.streakBase + extra * CONFIDENCE_WEIGHTS.streakStep);
}

export function buildConfidence(input: {
  streakPassed: boolean;
  occurrences: number;
  cadence?: "monthly" | "annual";
  streakDetail: string;
  dayPassed: boolean;
  dayDetail: string;
  amountPassed: boolean;
  amountDetail: string;
  catalogPassed: boolean;
  catalogDetail: string;
  recentPassed: boolean;
  recentDetail: string;
}): Confidence {
  const checks: ConfidenceCheck[] = [
    {
      id: "streak",
      label: CHECK_LABELS.streak,
      detail: input.streakDetail,
      passed: input.streakPassed,
      points: streakPoints(input.occurrences, input.streakPassed, input.cadence),
    },
    {
      id: "day",
      label: CHECK_LABELS.day,
      detail: input.dayDetail,
      passed: input.dayPassed,
      points: input.dayPassed ? CONFIDENCE_WEIGHTS.day : 0,
    },
    {
      id: "amount",
      label: CHECK_LABELS.amount,
      detail: input.amountDetail,
      passed: input.amountPassed,
      points: input.amountPassed ? CONFIDENCE_WEIGHTS.amount : 0,
    },
    {
      id: "catalog",
      label: CHECK_LABELS.catalog,
      detail: input.catalogDetail,
      passed: input.catalogPassed,
      points: input.catalogPassed ? CONFIDENCE_WEIGHTS.catalog : 0,
    },
    {
      id: "recent",
      label: CHECK_LABELS.recent,
      detail: input.recentDetail,
      passed: input.recentPassed,
      points: input.recentPassed ? CONFIDENCE_WEIGHTS.recent : 0,
    },
  ];
  const score = checks.reduce((sum, check) => sum + check.points, 0);
  return { score, label: confidenceLabel(score), checks };
}

/** Add a learned adjustment as its own check. The score stays inside 0–100. */
export function withLearned(confidence: Confidence, learned: { points: number; detail: string } | null): Confidence {
  if (!learned || learned.points === 0) return confidence;
  const checks: ConfidenceCheck[] = [
    ...confidence.checks,
    { id: "learned", label: CHECK_LABELS.learned, detail: learned.detail, passed: learned.points > 0, points: learned.points },
  ];
  const raw = checks.reduce((sum, check) => sum + check.points, 0);
  const score = Math.max(0, Math.min(100, raw));
  return { score, label: confidenceLabel(score), checks };
}
