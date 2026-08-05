/**
 * Tax math. Plan §5.5: `policy.tax.rate` (default NG VAT 7.5%) or a custom
 * function `(amountMinor) => taxMinor`. Rounding happens here, once.
 */

import { assertSafeMinor } from "./money.js";
import type { TaxPolicy } from "./types.js";

/** NG VAT. */
export const DEFAULT_TAX_RATE = 0.075;

export const DEFAULT_TAX_POLICY: TaxPolicy = { rate: DEFAULT_TAX_RATE };

/**
 * Compute tax on a pre-tax minor amount, returning an integer minor amount.
 * The single, documented rounding point for tax (plan §5.4).
 */
export function computeTax(amountMinor: number, tax: TaxPolicy = DEFAULT_TAX_POLICY): number {
  assertSafeMinor(amountMinor, "amountMinor");
  const raw = typeof tax === "function" ? tax(amountMinor) : amountMinor * tax.rate;
  const taxMinor = Math.round(raw);
  assertSafeMinor(taxMinor, "taxMinor");
  return taxMinor;
}
