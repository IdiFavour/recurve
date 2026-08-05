/**
 * Deterministic idempotency keys (plan §5.6). Same (subscriptionId, periodStart)
 * always yields the same key, so:
 *   - the consumer's UNIQUE constraint on the key dedups double-charges, and
 *   - passing the key as Paystack's `reference` adds a second guard layer.
 *
 * Uses `node:crypto` only — no runtime dependencies.
 */

import { createHash } from "node:crypto";

/** Namespacing prefix so keys are recognizable in the consumer's tables/logs. */
export const IDEMPOTENCY_PREFIX = "psb_";

/** Length of the hex digest slice appended after the prefix. */
const DIGEST_LENGTH = 32;

/**
 * Deterministic per subscription-period idempotency key.
 * `psb_` + first 32 hex chars of sha256(`${subscriptionId}|${periodStartISO}`).
 */
export function idempotencyKey(subscriptionId: string, periodStartISO: string): string {
  const digest = createHash("sha256").update(`${subscriptionId}|${periodStartISO}`).digest("hex");
  return `${IDEMPOTENCY_PREFIX}${digest.slice(0, DIGEST_LENGTH)}`;
}
