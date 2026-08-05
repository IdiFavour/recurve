/**
 * `planRenewal` (plan §4.1). Pure: computes what the current due period should
 * cost and the deterministic idempotency key to charge it with. No network.
 *
 * The period being charged starts at the subscription's `currentPeriodEnd` (its
 * next-charge anchor) and runs one interval forward. The idempotency key is keyed
 * to that period start, so it's stable for the whole period (plan §5.6).
 */

import { idempotencyKey } from "../ids.js";
import { parseISO, periodEnd as periodEndOf, toISO } from "../periods.js";
import type { ResolvedPolicy } from "../policy.js";
import { computeAmount } from "../pricing.js";
import type { RenewalPlan, Subscription } from "../types.js";
import { isTrialing } from "./describe.js";
import { isChargeableStatus } from "./stateMachine.js";

export interface RenewalContext {
  now: Date;
  policy: ResolvedPolicy;
}

export function planRenewal(sub: Subscription, ctx: RenewalContext): RenewalPlan {
  const periodStart = sub.currentPeriodEnd;
  const periodEnd = toISO(periodEndOf(parseISO(periodStart), sub.interval));

  const money = computeAmount(sub.amountMinor, {
    interval: sub.interval,
    currency: ctx.policy.currency,
    annual: ctx.policy.annual,
    tax: ctx.policy.tax,
  });

  const chargeable = isChargeableStatus(sub.status);
  const canceling = sub.cancelAtPeriodEnd === true;
  const shouldCharge = chargeable && !isTrialing(sub, ctx.now) && !canceling;

  return {
    idempotencyKey: idempotencyKey(sub.id, periodStart),
    amountMinor: money.totalMinor,
    currency: money.currency,
    periodStart,
    periodEnd,
    shouldCharge,
  };
}
