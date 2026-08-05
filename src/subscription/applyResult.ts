/**
 * `applyResult` (plan §4.1) — the dunning/lifecycle brain and the money-safety
 * core of the package (plan §7.3, §11.1).
 *
 * The double-advance guard: a charge's `reference` is the deterministic
 * idempotency key for the period it paid — `key(subId, currentPeriodEnd)`. We
 * recompute the key for the subscription's *current* due period and only act
 * when the result's reference matches it. Once the period has advanced (or a
 * failure has moved the anchor into grace), the same result no longer matches,
 * so replaying it — cron + webhook, or a webhook re-delivery — is a no-op.
 *
 * `applyResult` is a pure function returning the next *absolute* writable state
 * (never a delta), so feeding identical input always yields identical output.
 */

import { applyDunning } from "../dunning.js";
import { idempotencyKey } from "../ids.js";
import { parseISO, periodEnd as periodEndOf, toISO } from "../periods.js";
import type { ResolvedPolicy } from "../policy.js";
import type { ChargeResult, Subscription, SubscriptionState } from "../types.js";

export interface ApplyContext {
  now: Date;
  policy: ResolvedPolicy;
}

/** The subscription's current writable state, echoed unchanged (no-op path). */
function snapshot(sub: Subscription): SubscriptionState {
  return {
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
    retry: sub.retry,
    retryCount: sub.retryCount,
  };
}

export function applyResult(
  sub: Subscription,
  result: ChargeResult,
  ctx: ApplyContext
): SubscriptionState {
  // The key for the period currently due. A result that doesn't match it is
  // stale (already applied / replayed) → return current state untouched.
  const dueKey = idempotencyKey(sub.id, sub.currentPeriodEnd);
  if (result.reference !== dueKey) {
    return snapshot(sub);
  }

  if (result.status === "success") {
    const nextEnd = periodEndOf(parseISO(sub.currentPeriodEnd), sub.interval);
    return {
      status: "active",
      currentPeriodEnd: toISO(nextEnd),
      retry: false,
      retryCount: 0,
    };
  }

  // Failure → apply the dunning policy (grace → retry → revoke).
  return applyDunning(sub.retryCount, ctx.policy.dunning.graceScheduleDays, ctx.now);
}
