/**
 * Pricing math — the single source of truth for what a period costs (plan §4.1).
 * Composes the annual rule (plan §5.4) with tax (plan §5.5) into a `Money` result.
 *
 * The annual rule only transforms the base price when the interval is `annually`.
 * For every other interval the base minor amount is treated as the per-period
 * price and passed through unchanged.
 */

import { assertSafeMinor } from "./money.js";
import { computeTax } from "./tax.js";
import type { AnnualRule, Currency, Interval, Money, TaxPolicy } from "./types.js";

/** Default annual rule: `round((base / 2) * 12)` — roughly "2 months free". */
export const defaultAnnualRule: AnnualRule = (baseMinor) => Math.round((baseMinor / 2) * 12);

/** The pre-tax price for one period of `interval`, given a base minor amount. */
export function perIntervalAmount(
  baseMinor: number,
  interval: Interval,
  annual: AnnualRule = defaultAnnualRule
): number {
  assertSafeMinor(baseMinor, "baseMinor");
  const raw = interval === "annually" ? annual(baseMinor) : baseMinor;
  const subtotal = Math.round(raw);
  assertSafeMinor(subtotal, "subtotalMinor");
  return subtotal;
}

export interface ComputeAmountOptions {
  interval: Interval;
  currency: Currency;
  annual?: AnnualRule;
  tax?: TaxPolicy;
}

/**
 * `computeAmount` from plan §4.1 in its pure form: annual rule + tax → `Money`.
 * The `createBilling` factory (Milestone 7) wraps this with the configured policy
 * so consumers call `billing.computeAmount(baseMinor, interval)`.
 */
export function computeAmount(baseMinor: number, opts: ComputeAmountOptions): Money {
  const subtotalMinor = perIntervalAmount(
    baseMinor,
    opts.interval,
    opts.annual ?? defaultAnnualRule
  );
  const taxMinor = computeTax(subtotalMinor, opts.tax);
  const totalMinor = subtotalMinor + taxMinor;
  assertSafeMinor(totalMinor, "totalMinor");
  return { currency: opts.currency, subtotalMinor, taxMinor, totalMinor };
}
