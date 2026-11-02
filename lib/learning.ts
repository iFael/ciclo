import { descriptorWords } from "@/lib/text";
import type { AppState } from "@/lib/types";

/**
 * Learning from the user's own choices. No model, no extra tables: the
 * confirmed and refused plans already stored are the training data.
 *
 * - Confirmed plans (active or not) are "liked".
 * - Refused suggestions ("Não é") and refused descriptors are "disliked".
 *
 * A new suggestion whose descriptor looks like a liked one gets +15, and one
 * that looks like a disliked one gets −25. Refusals weigh more, so the list
 * stops repeating what the user already said no to.
 */

export const LEARNED_BOOST = 15;
export const LEARNED_PENALTY = -25;
const JACCARD_MIN = 0.34;
const DISTINCT_MIN_LENGTH = 4;

const STOPWORDS = new Set([
  "COM",
  "BR",
  "DO",
  "DA",
  "DE",
  "DOS",
  "DAS",
  "E",
  "PAG",
  "PAGTO",
  "PAGAMENTO",
  "COMPRA",
  "COMPRAS",
  "INC",
  "LTDA",
  "SA",
  "ME",
  "WWW",
  "HTTP",
  "HTTPS",
  "SUBSCR",
  "SUBSCRIPTION",
  "ASSINATURA",
  "BILL",
  "MENSAL",
  "PLANO",
  "SAO",
  "PAULO",
  "SP",
  "RJ",
]);

export type Feedback = { liked: string[][]; disliked: string[][] };

export function keyWords(descriptor: string): string[] {
  return [...new Set(descriptorWords(descriptor).filter((word) => word.length > 1 && !STOPWORDS.has(word) && !/^\d+$/.test(word)))];
}

export function feedbackFrom(state: AppState): Feedback {
  const liked: string[][] = [];
  const disliked: string[][] = [];
  const push = (target: string[][], descriptor: string) => {
    const words = keyWords(descriptor);
    if (words.length > 0) target.push(words);
  };
  for (const subscription of state.subscriptions) {
    if (subscription.status === "confirmed" || subscription.status === "cancelled") {
      for (const descriptor of subscription.descriptors) push(liked, descriptor);
      push(liked, subscription.planName);
    } else if (subscription.status === "ignored") {
      for (const descriptor of subscription.descriptors) push(disliked, descriptor);
    }
  }
  for (const item of state.ignoredDescriptors) {
    if (!item.startsWith("merchant:")) push(disliked, item);
  }
  return { liked, disliked };
}

function similar(left: string[], right: string[]): boolean {
  const a = new Set(left);
  const b = new Set(right);
  let shared = 0;
  let distinct = false;
  for (const word of a) {
    if (!b.has(word)) continue;
    shared += 1;
    if (word.length >= DISTINCT_MIN_LENGTH) distinct = true;
  }
  if (shared === 0) return false;
  const union = new Set([...a, ...b]).size;
  return distinct || shared / union >= JACCARD_MIN;
}

function matchesAny(words: string[], pool: string[][]): boolean {
  return pool.some((other) => similar(words, other));
}

/**
 * Points and a short explanation, or null when the user's history says nothing
 * about this charge.
 */
export function learnedAdjustment(descriptors: string[], feedback: Feedback): { points: number; detail: string } | null {
  const sets = descriptors.map(keyWords).filter((words) => words.length > 0);
  if (sets.length === 0) return null;
  if (sets.some((words) => matchesAny(words, feedback.disliked))) {
    return { points: LEARNED_PENALTY, detail: "parecido com o que você recusou" };
  }
  if (sets.some((words) => matchesAny(words, feedback.liked))) {
    return { points: LEARNED_BOOST, detail: "parecido com o que você confirmou" };
  }
  return null;
}
