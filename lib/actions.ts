import { latestChargeDate } from "@/lib/charges";
import { merchantDescriptor } from "@/lib/text";
import { isOutgoing, isPix, isSubscriptionCandidate, paymentKey } from "@/lib/payment-identity";
import { isForeignService, planNameFor, serviceInfo } from "@/lib/catalog";
import { formatBrl } from "@/lib/format";
import { merchantIgnoreToken, normalizeDescriptor, withinPercent, type Detection } from "@/lib/matching";
import type { AppState, Subscription, SubscriptionStatus } from "@/lib/types";

export type PlanAction =
  | { action: "confirm"; id: string }
  | { action: "ignore"; id: string }
  | { action: "pick-apple"; id: string; service: string; replaces?: string }
  | { action: "remove"; id: string }
  | { action: "undo"; id: string }
  | { action: "still-paying"; id: string }
  | { action: "cancelled"; id: string }
  | { action: "restore-charging"; id: string }
  | { action: "ignore-charging"; id: string }
  | { action: "set-domain"; id: string; domain: string }
  | { action: "set-manage-url"; id: string; url: string };

/** A web link the Gerenciar button may open: https only, no credentials. Empty clears it. */
export function cleanManageUrl(input: string): string | null | undefined {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function findSub(state: AppState, id: string): Subscription | undefined {
  return state.subscriptions.find((subscription) => subscription.id === id);
}

export function applyAction(input: AppState, command: PlanAction, now: Date): AppState {
  const state = clone(input);
  const subscription = findSub(state, command.id);
  if (!subscription) return state;

  if (command.action === "confirm" && subscription.status === "suggested") {
    subscription.status = "confirmed";
    subscription.autoConfirmed = false;
    subscription.suppressAutoConfirm = true;
    subscription.suggestionLabel = null;
    subscription.checked = false;
    subscription.undoStatus = null;
    return dropShadowedSuggestions(state);
  }

  if (command.action === "ignore" && subscription.status === "suggested") {
    subscription.status = "ignored";
    subscription.undoStatus = null;
    // "Not a subscription" is a "not now": no ignore token, so the next sync suggests it again.
    return state;
  }

  if (command.action === "pick-apple") {
    const picked = serviceInfo(command.service);
    if (!picked || picked.id === "apple") return state;
    subscription.service = picked.id;
    subscription.planName = planNameFor(picked.id, subscription.amount);
    subscription.status = "confirmed";
    // The App Store bills a fixed price in reais, even for a service priced in dollars.
    subscription.approximate = false;
    subscription.autoConfirmed = false;
    subscription.suppressAutoConfirm = true;
    subscription.suggestionLabel = null;
    subscription.undoStatus = null;
    // The same service moved from direct billing to the App Store: the old plan
    // stays in the history as cancelled instead of showing as "sem cobrança".
    const replaced = command.replaces ? findSub(state, command.replaces) : undefined;
    if (replaced && replaced.id !== subscription.id && replaced.status === "confirmed" && replaced.service === picked.id) {
      replaced.status = "cancelled";
    }
    return state;
  }

  if (command.action === "remove" && subscription.status !== "dismissed") {
    const backToSuggestions =
      subscription.status === "confirmed" && subscription.suppressAutoConfirm && !subscription.autoConfirmed;
    if (backToSuggestions) {
      subscription.undoStatus = "confirmed";
      subscription.status = "suggested";
      subscription.dismissedAt = null;
      subscription.autoConfirmed = false;
      subscription.suppressAutoConfirm = true;
      if (!subscription.suggestionLabel) subscription.suggestionLabel = "Pode ser recorrente";
      return state;
    }
    subscription.undoStatus = subscription.status;
    subscription.status = "dismissed";
    subscription.dismissedAt = now.toISOString();
    subscription.autoConfirmed = false;
    return state;
  }

  if (command.action === "undo") {
    if (subscription.status === "dismissed" && subscription.undoStatus) {
      subscription.status = subscription.undoStatus;
      subscription.dismissedAt = null;
      subscription.undoStatus = null;
      return state;
    }
    if (subscription.status === "suggested" && subscription.undoStatus === "confirmed") {
      subscription.status = "confirmed";
      subscription.undoStatus = null;
      subscription.dismissedAt = null;
      subscription.autoConfirmed = false;
      subscription.suppressAutoConfirm = true;
      subscription.suggestionLabel = null;
      subscription.checked = false;
      return state;
    }
    if (subscription.autoConfirmed && subscription.status === "confirmed") {
      subscription.status = "suggested";
      subscription.autoConfirmed = false;
      subscription.suppressAutoConfirm = true;
      subscription.undoStatus = null;
      subscription.suggestionLabel = "Pode ser recorrente";
    }
    return state;
  }

  if (command.action === "set-manage-url") {
    const url = cleanManageUrl(command.url ?? "");
    if (url !== undefined) subscription.manageUrl = url;
    return state;
  }

  if (command.action === "still-paying") {
    const last = latestChargeDate(state, subscription.id) ?? subscription.expectedChargeDate;
    subscription.cancelPromptSnoozeDate = last;
    return state;
  }

  if (command.action === "cancelled") {
    subscription.status = "cancelled";
    return state;
  }

  if (command.action === "restore-charging" || command.action === "ignore-charging") {
    const dismissedOn = subscription.dismissedAt?.slice(0, 10) ?? "";
    for (const charge of state.charges) {
      if (charge.subscriptionId === subscription.id && charge.chargeDate > dismissedOn) charge.resolved = true;
    }
    if (command.action === "ignore-charging") {
      subscription.status = "ignored";
      const token = merchantIgnoreToken(subscription.merchantKey);
      if (!state.ignoredDescriptors.includes(token)) state.ignoredDescriptors.push(token);
      for (const descriptor of subscription.descriptors) {
        const normalized = normalizeDescriptor(descriptor);
        if (!state.ignoredDescriptors.includes(normalized)) state.ignoredDescriptors.push(normalized);
      }
    } else {
      subscription.status = "confirmed";
      subscription.dismissedAt = null;
      subscription.undoStatus = null;
    }
  }
  return state;
}

export function mergeDetections(
  input: AppState,
  detections: import("@/lib/matching").Detection[],
  ok: boolean,
): AppState {
  if (!ok) return input;
  const state = clone(input);
  const ignored = new Set(state.ignoredDescriptors.map((item) => normalizeDescriptor(item)));
  for (const detection of detections) {
    if (detection.descriptors.length > 0 && detection.descriptors.every((item) => ignored.has(item))) continue;
    const existing = state.subscriptions.find((subscription) => subscription.merchantKey === detection.merchantKey);
    if (!existing) {
      const id = crypto.randomUUID();
      const status: SubscriptionStatus = detection.confirm ? "confirmed" : "suggested";
      state.subscriptions.push({
        id,
        service: detection.service,
        planName: detection.planName,
        status,
        dismissedAt: null,
        approximate: detection.approximate,
        merchantKey: detection.merchantKey,
        amount: detection.amount,
        expectedChargeDate: detection.expectedChargeDate,
        checked: detection.checked,
        autoConfirmed: detection.autoConfirmed,
        planChangeNotice: detection.planChangeNotice,
        undoStatus: detection.autoConfirmed ? "suggested" : null,
        suppressAutoConfirm: false,
        cancelPromptSnoozeDate: null,
        descriptors: detection.descriptors,
        suggestionLabel: detection.suggestionLabel,
      });
      for (const charge of detection.charges) {
        state.charges.push({
          subscriptionId: id,
          chargeDate: charge.chargeDate,
          amount: charge.amount,
          transactionId: charge.transactionId,
          resolved: false,
        });
      }
      continue;
    }
    if (existing.status === "ignored" && !state.ignoredDescriptors.includes(merchantIgnoreToken(existing.merchantKey))) {
      existing.status = "suggested";
    }
    if (existing.status === "ignored" || existing.status === "cancelled") continue;
    for (const charge of detection.charges) {
      const already = state.charges.some(
        (item) => item.subscriptionId === existing.id && item.chargeDate === charge.chargeDate,
      );
      if (!already) {
        state.charges.push({
          subscriptionId: existing.id,
          chargeDate: charge.chargeDate,
          amount: charge.amount,
          transactionId: charge.transactionId,
          resolved: false,
        });
      }
    }
    if (existing.status === "dismissed") continue;
    if (!withinPercent(existing.amount, detection.amount, 0.15)) {
      existing.planChangeNotice = `O valor passou de ${formatBrl(existing.amount)} para ${formatBrl(detection.amount)}.`;
    } else if (detection.planChangeNotice) {
      existing.planChangeNotice = detection.planChangeNotice;
    }
    existing.amount = detection.amount;
    if (detection.service === "apple" && existing.service !== "apple") {
      existing.planName = planNameFor(existing.service, detection.amount);
    } else if (detection.service !== "apple") {
      existing.service = detection.service;
      existing.planName = detection.planName;
    } else {
      existing.planName = "Assinatura via Apple";
    }
    existing.approximate = detection.approximate || existing.approximate;
    existing.expectedChargeDate = detection.expectedChargeDate;
    existing.descriptors = detection.descriptors;
    existing.checked = detection.checked;
    if (existing.status === "confirmed") continue;
    if (existing.suppressAutoConfirm) {
      existing.suggestionLabel = detection.suggestionLabel ?? existing.suggestionLabel;
      continue;
    }
    if (detection.confirm) {
      existing.status = "confirmed";
      existing.autoConfirmed = detection.autoConfirmed;
      existing.undoStatus = detection.autoConfirmed ? "suggested" : existing.undoStatus;
      existing.suggestionLabel = null;
    } else {
      existing.suggestionLabel = detection.suggestionLabel;
    }
  }
  return state;
}

/** Drop suggested rows the current history no longer supports. Confirmed and ignored stay. */
export function pruneSuggestions(input: AppState, detections: Detection[]): AppState {
  const keys = new Set(detections.map((detection) => detection.merchantKey));
  const state = clone(input);
  const removed = new Set<string>();
  state.subscriptions = state.subscriptions.filter((subscription) => {
    if (subscription.status !== "suggested" || subscription.suppressAutoConfirm) return true;
    if (keys.has(subscription.merchantKey)) return true;
    removed.add(subscription.id);
    return false;
  });
  if (removed.size > 0) state.charges = state.charges.filter((charge) => !removed.has(charge.subscriptionId));
  return state;
}

/**
 * Keep following plans the user confirmed. A new card charge with one of the
 * plan's descriptors and an amount within 15% is linked to the plan, even when
 * it is a single charge after a pause, so an inactive plan becomes active
 * again by itself.
 */
export function attachKnownCharges(
  input: AppState,
  transactions: (Pick<import("@/lib/types").StoredTx, "id" | "description" | "amount" | "chargeDate"> & Partial<import("@/lib/types").StoredTx>)[],
): AppState {
  const state = clone(input);
  const linked = new Set(state.charges.map((charge) => charge.transactionId));
  for (const subscription of state.subscriptions) {
    if (subscription.status !== "confirmed" || subscription.descriptors.length === 0) continue;
    const descriptors = new Set(subscription.descriptors.map((item) => merchantDescriptor(item)));
    for (const tx of transactions) {
      if (linked.has(tx.id) || !isOutgoing(tx)) continue;
      const matchingDescriptor = !isPix(tx) && descriptors.has(merchantDescriptor(tx.description));
      const matchingPayment = isSubscriptionCandidate(tx) && (subscription.paymentMatches ?? []).some((match) =>
        match.key === paymentKey(tx) && match.accountId === tx.accountId && withinPercent(match.amount, tx.amount, 0.15),
      );
      if (!matchingDescriptor && !matchingPayment) continue;
      if (!withinPercent(subscription.amount, tx.amount, 0.15)) continue;
      if (state.charges.some((charge) => charge.subscriptionId === subscription.id && charge.chargeDate === tx.chargeDate)) continue;
      state.charges.push({
        subscriptionId: subscription.id,
        chargeDate: tx.chargeDate,
        amount: tx.amount,
        transactionId: tx.id,
        resolved: false,
      });
      linked.add(tx.id);
      if (!subscription.expectedChargeDate || tx.chargeDate > subscription.expectedChargeDate) {
        subscription.expectedChargeDate = tx.chargeDate;
      }
    }
  }
  return state;
}

/** True when a confirmed or cancelled plan already covers this suggestion's merchant. */
export function isShadowed(suggestion: Subscription, subscriptions: Subscription[]): boolean {
  if (suggestion.status !== "suggested") return false;
  const mine = new Set(suggestion.descriptors.map((descriptor) => merchantDescriptor(descriptor)));
  return subscriptions.some((plan) => {
    if (plan.id === suggestion.id || (plan.status !== "confirmed" && plan.status !== "cancelled")) return false;
    if (plan.merchantKey === suggestion.merchantKey) return true;
    const sameService = plan.service === suggestion.service && plan.service !== "unknown" && plan.service !== "apple";
    if ((plan.paymentMatches ?? []).some((match) => suggestion.merchantKey.startsWith(`unknown:${match.key}:`) && withinPercent(match.amount, suggestion.amount, 0.15))) return true;
    return sameService || plan.descriptors.some((descriptor) => mine.has(merchantDescriptor(descriptor)));
  });
}

/**
 * A plan confirmed from search or by a known merchant gets its own key, so an
 * older suggestion for the same merchant would linger. Remove it.
 */
export function dropShadowedSuggestions(input: AppState): AppState {
  const removed = new Set(input.subscriptions.filter((item) => isShadowed(item, input.subscriptions)).map((item) => item.id));
  if (removed.size === 0) return input;
  const state = clone(input);
  state.subscriptions = state.subscriptions.filter((item) => !removed.has(item.id));
  state.charges = state.charges.filter((charge) => !removed.has(charge.subscriptionId));
  return state;
}
