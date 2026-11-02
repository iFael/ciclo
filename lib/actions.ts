import { latestChargeDate } from "@/lib/charges";
import { merchantDescriptor } from "@/lib/text";
import { isForeignService, planNameFor, serviceInfo } from "@/lib/catalog";
import { formatBrl } from "@/lib/format";
import { merchantIgnoreToken, normalizeDescriptor, withinPercent, type Detection } from "@/lib/matching";
import type { AppState, Subscription, SubscriptionStatus } from "@/lib/types";

export type PlanAction =
  | { action: "confirm"; id: string }
  | { action: "ignore"; id: string }
  | { action: "pick-apple"; id: string; service: string }
  | { action: "remove"; id: string }
  | { action: "undo"; id: string }
  | { action: "still-paying"; id: string }
  | { action: "cancelled"; id: string }
  | { action: "restore-charging"; id: string }
  | { action: "ignore-charging"; id: string }
  | { action: "set-domain"; id: string; domain: string };

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
    return state;
  }

  if (command.action === "ignore" && subscription.status === "suggested") {
    subscription.status = "ignored";
    subscription.undoStatus = null;
    const token = merchantIgnoreToken(subscription.merchantKey);
    if (!state.ignoredDescriptors.includes(token)) state.ignoredDescriptors.push(token);
    return state;
  }

  if (command.action === "pick-apple") {
    const picked = serviceInfo(command.service);
    if (!picked || picked.id === "apple") return state;
    subscription.service = picked.id;
    subscription.planName = planNameFor(picked.id, subscription.amount);
    subscription.status = "confirmed";
    subscription.approximate = isForeignService(picked.id);
    subscription.autoConfirmed = false;
    subscription.suppressAutoConfirm = true;
    subscription.suggestionLabel = null;
    subscription.undoStatus = null;
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
  transactions: { id: string; description: string; amount: number; chargeDate: string }[],
): AppState {
  const state = clone(input);
  const linked = new Set(state.charges.map((charge) => charge.transactionId));
  for (const subscription of state.subscriptions) {
    if (subscription.status !== "confirmed" || subscription.descriptors.length === 0) continue;
    const descriptors = new Set(subscription.descriptors.map((item) => merchantDescriptor(item)));
    for (const tx of transactions) {
      if (linked.has(tx.id) || tx.amount <= 0) continue;
      if (!descriptors.has(merchantDescriptor(tx.description))) continue;
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
