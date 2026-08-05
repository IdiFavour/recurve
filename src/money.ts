/**
 * Money helpers. Plan §5.4: all amounts are integer minor units (kobo). We only
 * ever round at explicit, documented points; never accumulate float drift.
 *
 * Amounts may be negative (proration credits, plan §4.1), so guards check
 * integer-ness and safe-range only — not sign.
 */

export const KOBO_PER_NAIRA = 100;

/**
 * Throws unless `amountMinor` is a safe integer. This is the money-safety net:
 * a non-integer minor amount means float drift crept in somewhere upstream.
 */
export function assertSafeMinor(amountMinor: number, label = "amountMinor"): void {
  if (!Number.isInteger(amountMinor)) {
    throw new RangeError(
      `${label} must be an integer in minor units (kobo), received ${amountMinor}`
    );
  }
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError(`${label} is outside the safe integer range: ${amountMinor}`);
  }
}

/** Convert major units (naira) to minor units (kobo). Rounds to the nearest kobo. */
export function nairaToKobo(major: number): number {
  const minor = Math.round(major * KOBO_PER_NAIRA);
  assertSafeMinor(minor, "kobo");
  return minor;
}

/** Convert minor units (kobo) to major units (naira). For display only. */
export function koboToNaira(minor: number): number {
  assertSafeMinor(minor, "kobo");
  return minor / KOBO_PER_NAIRA;
}

// Plan §5.4 shorthands: `naira(n) → kobo` and `kobo(n) → naira`.
// The function name is the *input* unit.
export const naira = nairaToKobo;
export const kobo = koboToNaira;
