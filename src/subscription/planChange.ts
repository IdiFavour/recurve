/**
 * `planChange` — proration (plan §4.1, §11.7). Pure, no network.
 *
 * Paystack has no proration, so we compute it. For `immediate` changes we credit
 * the unused portion of the current plan and charge the same fraction of the new
 * plan for the remainder of the cycle; the net is `prorationMinor` (positive =
 * charge now, negative = credit). `next_cycle` and `none` do not bill now.
 *
 * The subscription doesn't store the period *start*, so we derive it as
 * `currentPeriodEnd - interval`. The consumer persists the new plan fields
 * (planId/amountMinor/interval) themselves; `nextState` only carries the
 * lifecycle fields this package owns.
 */

import { idempotencyKey } from "../ids.js";
import { assertSafeMinor } from "../money.js";
import { addInterval, parseISO, toISO } from "../periods.js";
import type { ResolvedPolicy } from "../policy.js";
import { computeAmount } from "../pricing.js";
import type { PlanChange, PlanChangeInput, Subscription, SubscriptionState } from "../types.js";

export interface PlanChangeContext {
  now: Date;
  policy: ResolvedPolicy;
}

/** Fraction of the current period still unused at `now`, clamped to [0, 1]. */
function remainingFraction(periodStart: Date, periodEnd: Date, now: Date): number {
  const total = periodEnd.getTime() - periodStart.getTime();
  if (total <= 0) return 0;
  const remaining = periodEnd.getTime() - now.getTime();
  return Math.min(1, Math.max(0, remaining / total));
}

export function planChange(
  sub: Subscription,
  newPlan: PlanChangeInput,
  ctx: PlanChangeContext
): PlanChange {
  const periodEnd = parseISO(sub.currentPeriodEnd);
  const periodStart = addInterval(periodEnd, sub.interval, -1);
  const newInterval = newPlan.interval ?? sub.interval;

  const unchangedState: SubscriptionState = {
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
    retry: sub.retry,
    retryCount: sub.retryCount,
  };

  // Deterministic key for this (subscription, target plan, current period).
  const key = idempotencyKey(sub.id, `change|${newPlan.planId}|${toISO(periodStart)}`);

  if (ctx.policy.proration === "next_cycle") {
    // No charge now; the swap takes effect at the next renewal.
    return {
      prorationMinor: 0,
      idempotencyKey: key,
      effectiveAt: sub.currentPeriodEnd,
      nextState: unchangedState,
    };
  }

  if (ctx.policy.proration === "none") {
    // Immediate swap, no money moves.
    return {
      prorationMinor: 0,
      idempotencyKey: key,
      effectiveAt: toISO(ctx.now),
      nextState: unchangedState,
    };
  }

  // 'immediate': credit the unused current plan, charge the same fraction of the new plan.
  const fraction = remainingFraction(periodStart, periodEnd, ctx.now);
  const currentTotal = computeAmount(sub.amountMinor, {
    interval: sub.interval,
    currency: ctx.policy.currency,
    annual: ctx.policy.annual,
    tax: ctx.policy.tax,
  }).totalMinor;
  const newTotal = computeAmount(newPlan.amountMinor, {
    interval: newInterval,
    currency: ctx.policy.currency,
    annual: ctx.policy.annual,
    tax: ctx.policy.tax,
  }).totalMinor;

  const unusedCredit = Math.round(currentTotal * fraction);
  const newCharge = Math.round(newTotal * fraction);
  const prorationMinor = newCharge - unusedCredit;
  assertSafeMinor(prorationMinor, "prorationMinor");

  return {
    prorationMinor,
    idempotencyKey: key,
    effectiveAt: toISO(ctx.now),
    nextState: unchangedState,
  };
}
