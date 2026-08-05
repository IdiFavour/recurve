/**
 * Dunning brain (plan §5.2). Pure: given the attempts used so far and the
 * resolved grace schedule, compute the next lifecycle fields on a charge failure.
 *
 * This is subscription-level dunning — completely separate from the HTTP-layer
 * transient retry in the Paystack client (plan §6).
 */

import { addDays, toISO } from "./periods.js";
import type { SubscriptionState } from "./types.js";

/**
 * Apply the dunning policy to a failed charge.
 *
 * @param retryCount  attempts already used (before this failure)
 * @param graceScheduleDays  per-retry grace windows in days (from ResolvedPolicy)
 * @param now  the clock's current time
 */
export function applyDunning(
  retryCount: number,
  graceScheduleDays: number[],
  now: Date
): SubscriptionState {
  const nextRetryCount = retryCount + 1;
  const maxRetries = graceScheduleDays.length;

  // Retries remain: enter/stay in grace, keep the retry flag on.
  if (nextRetryCount <= maxRetries) {
    const graceDays = graceScheduleDays[nextRetryCount - 1] ?? 0;
    return {
      status: "past_due",
      currentPeriodEnd: toISO(addDays(now, graceDays)),
      retry: true,
      retryCount: nextRetryCount,
    };
  }

  // Retries exhausted (or maxRetries === 0): revoke.
  return {
    status: "revoked",
    currentPeriodEnd: toISO(now),
    retry: false,
    retryCount: nextRetryCount,
  };
}
