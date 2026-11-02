import { catalog, planNameFor, serviceInfo } from "@/lib/catalog";
import { chargeDates } from "@/lib/charges";
import { diffDays } from "@/lib/dates";
import { formatDayMonth } from "@/lib/format";
import { isAppleBill, isGooglePlayBill } from "@/lib/matching";
import type { AppState, Subscription } from "@/lib/types";

/**
 * Who bills the plan, read from the statement text. A plan bought inside an
 * iPhone or Android app is billed by the store, and only the store can cancel
 * it: the service's own site has nothing to manage.
 */
export type BillingChannel = "apple" | "google-play" | "direct";

export type StoreInfo = { company: string; manageUrl: string; button: string };

export const STORES: Record<Exclude<BillingChannel, "direct">, StoreInfo> = {
  apple: {
    company: "Apple",
    // Opens Settings › Subscriptions on an iPhone, the web account page elsewhere.
    manageUrl: "https://apps.apple.com/account/subscriptions",
    button: "Gerenciar na Apple",
  },
  "google-play": {
    company: "Google Play",
    manageUrl: "https://play.google.com/store/account/subscriptions",
    button: "Gerenciar no Google Play",
  },
};

export function channelOfDescriptors(descriptors: string[]): BillingChannel {
  if (descriptors.some((descriptor) => isAppleBill(descriptor))) return "apple";
  if (descriptors.some((descriptor) => isGooglePlayBill(descriptor))) return "google-play";
  return "direct";
}

export function billingChannel(subscription: Pick<Subscription, "service" | "descriptors">): BillingChannel {
  if (subscription.service === "apple") return "apple";
  return channelOfDescriptors(subscription.descriptors);
}

export { isGooglePlayBill };

export type ServiceGuess = {
  service: string;
  serviceName: string;
  planName: string;
  reason: string;
  /** A plan billed directly that stopped when this one started: the same service changing channel. */
  replaces: string | null;
};

const SWITCH_WINDOW_DAYS = 45;
const STOPPED_AFTER_DAYS = 35;
const SWITCH_AMOUNT_PERCENT = 0.25;

/**
 * Which service an App Store charge most likely is. Apple's statement text
 * never names the app, so two hints are used, strongest first:
 * 1. A plan the user had billed directly stopped charging close to when this
 *    Apple charge started, at a similar price.
 * 2. Only one of the services offered in the picker has a plan at this price.
 * The user still confirms; this only fills in the picker.
 */
export function guessAppleService(
  suggestion: Subscription,
  state: AppState,
  today: string,
  choices: string[],
): ServiceGuess | null {
  if (suggestion.service !== "apple") return null;
  const first = chargeDates(state, suggestion.id)[0] ?? suggestion.expectedChargeDate;

  if (first) {
    let best: { plan: Subscription; last: string; distance: number } | null = null;
    for (const plan of state.subscriptions) {
      if (plan.id === suggestion.id || (plan.status !== "confirmed" && plan.status !== "cancelled")) continue;
      if (plan.service === "apple" || plan.service === "unknown" || !serviceInfo(plan.service)) continue;
      if (billingChannel(plan) === "apple") continue;
      const last = chargeDates(state, plan.id).at(-1);
      if (!last) continue;
      if (diffDays(last, today) < STOPPED_AFTER_DAYS) continue;
      const distance = Math.abs(diffDays(last, first));
      if (distance > SWITCH_WINDOW_DAYS) continue;
      if (Math.abs(plan.amount - suggestion.amount) / Math.max(plan.amount, 0.01) > SWITCH_AMOUNT_PERCENT) continue;
      if (!best || distance < best.distance) best = { plan, last, distance };
    }
    if (best) {
      const info = serviceInfo(best.plan.service)!;
      return {
        service: info.id,
        serviceName: info.serviceName,
        planName: best.plan.planName,
        reason: `Parece ${best.plan.planName}: a cobrança direta parou em ${formatDayMonth(best.last)} e esta, pela Apple, começou em ${formatDayMonth(first)}.`,
        replaces: best.plan.status === "confirmed" ? best.plan.id : null,
      };
    }
  }

  const byPrice = catalog().filter(
    (service) =>
      choices.includes(service.id) &&
      service.plans.some((plan) => suggestion.amount >= plan.minBrl - 0.01 && suggestion.amount <= plan.maxBrl + 0.01),
  );
  if (byPrice.length !== 1) return null;
  const planName = planNameFor(byPrice[0].id, suggestion.amount);
  return {
    service: byPrice[0].id,
    serviceName: byPrice[0].serviceName,
    planName,
    reason: `Pelo valor, parece ${planName}.`,
    replaces: null,
  };
}
