/**
 * Policy defaults + merge (plan §3). Turns the consumer's optional `BillingPolicy`
 * into a fully-resolved policy the pure billing functions can rely on.
 *
 * The dunning config is normalized into a single `graceScheduleDays` array — the
 * length is the number of retries, each entry is that attempt's grace window in
 * days. This unifies the simple `{maxRetries, graceDays}` form and the explicit
 * `retrySchedule` array (plan §5.2).
 */

import { defaultAnnualRule } from "./pricing.js";
import { DEFAULT_TAX_POLICY } from "./tax.js";
import type { AnnualRule, BillingPolicy, Currency, ProrationMode, TaxPolicy } from "./types.js";

// DECISION (§16.3): default dunning is 1 retry / 7-day grace. Fully configurable
// via policy.dunning: either {maxRetries, graceDays} or an explicit retrySchedule
// array (e.g. [3, 7]).
export const DEFAULT_MAX_RETRIES = 1;
export const DEFAULT_GRACE_DAYS = 7;
export const DEFAULT_PRORATION: ProrationMode = "immediate";
export const DEFAULT_CURRENCY: Currency = "NGN";

/** The fully-resolved policy used internally by the billing functions. */
export interface ResolvedPolicy {
  dunning: {
    /** Grace window (days) for each retry attempt, in order. `[]` = revoke on first failure. */
    graceScheduleDays: number[];
  };
  proration: ProrationMode;
  annual: AnnualRule;
  tax: TaxPolicy;
  currency: Currency;
  clock: () => Date;
}

/** Normalize dunning config into an ordered array of per-retry grace windows. */
export function resolveGraceSchedule(dunning?: BillingPolicy["dunning"]): number[] {
  if (dunning?.retrySchedule && dunning.retrySchedule.length > 0) {
    return [...dunning.retrySchedule];
  }
  const maxRetries = dunning?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const graceDays = dunning?.graceDays ?? DEFAULT_GRACE_DAYS;
  if (maxRetries <= 0) return [];
  return new Array(maxRetries).fill(graceDays);
}

/** Merge a user policy over the defaults into a `ResolvedPolicy`. */
export function resolvePolicy(policy?: BillingPolicy): ResolvedPolicy {
  return {
    dunning: { graceScheduleDays: resolveGraceSchedule(policy?.dunning) },
    proration: policy?.proration ?? DEFAULT_PRORATION,
    annual: policy?.pricing?.annual ?? defaultAnnualRule,
    tax: policy?.tax ?? DEFAULT_TAX_POLICY,
    currency: policy?.currency ?? DEFAULT_CURRENCY,
    clock: policy?.clock ?? (() => new Date()),
  };
}
