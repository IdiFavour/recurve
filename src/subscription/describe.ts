/**
 * Read-model helpers (plan §4.1): `describe` and `isDue`. Pure interpretation of
 * stored subscription state — no network, no mutation.
 */

import { parseISO } from "../periods.js";
import type { Subscription, SubscriptionView } from "../types.js";
import { isChargeableStatus } from "./stateMachine.js";

/** True while the trial window is genuinely open at `now`. */
export function isTrialing(sub: Subscription, now: Date): boolean {
  if (sub.trialEndsAt) {
    return parseISO(sub.trialEndsAt) > now;
  }
  return sub.status === "trialing";
}

/**
 * `isDue` (plan §4.1): chargeable status AND the period has ended.
 * A helper only — at scale the consumer should filter in their DB query.
 */
export function isDue(sub: Subscription, now: Date): boolean {
  if (!isChargeableStatus(sub.status)) return false;
  if (isTrialing(sub, now)) return false;
  return parseISO(sub.currentPeriodEnd) <= now;
}

/** `describe` (plan §4.1): the tracking/UI read-model. */
export function describe(sub: Subscription, now: Date): SubscriptionView {
  const canceling = sub.cancelAtPeriodEnd === true;
  const chargeable = isChargeableStatus(sub.status);
  return {
    state: sub.status,
    nextBillingDate: sub.currentPeriodEnd,
    inGrace: sub.status === "past_due" && sub.retry === true,
    willRenew: chargeable && !canceling,
    isTrialing: isTrialing(sub, now),
    isCanceling: canceling && !isTerminalCanceling(sub),
  };
}

/** Once already canceled/expired/revoked, "isCanceling" is no longer meaningful. */
function isTerminalCanceling(sub: Subscription): boolean {
  return sub.status === "canceled" || sub.status === "expired" || sub.status === "revoked";
}
