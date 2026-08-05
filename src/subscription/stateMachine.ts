/**
 * Subscription state machine (plan §5.1). Declarative predicates the billing
 * functions use to decide what's chargeable, terminal, or in-progress.
 *
 *   trialing ──trial ends──> active
 *   active   ──charge ok──> active (period advanced)
 *   active   ──charge fails──> past_due (grace, retry=true)
 *   past_due ──retry ok──> active
 *   past_due ──grace elapsed / retries exhausted──> revoked
 *   active   ──cancelAtPeriodEnd──> canceled ──> expired
 *   active   ──pause──> paused ──resume──> active
 */

import type { SubscriptionStatus } from "../types.js";

/**
 * Statuses where a due charge should fire. `trialing` is included so the first
 * post-trial charge can happen; `planRenewal` still suppresses charging while
 * the trial window is genuinely open.
 */
export const CHARGEABLE_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  "active",
  "past_due",
  "trialing",
]);

/** Terminal statuses — no further billing occurs. */
export const TERMINAL_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  "canceled",
  "expired",
  "revoked",
]);

/** True if a subscription in this status is eligible to be charged. */
export function isChargeableStatus(status: SubscriptionStatus): boolean {
  return CHARGEABLE_STATUSES.has(status);
}

/** True if a subscription in this status has reached the end of its lifecycle. */
export function isTerminalStatus(status: SubscriptionStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}
