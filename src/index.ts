/**
 * @idifavour/recurve — stateless recurring subscription billing for Paystack.
 *
 * The `createBilling` factory (Milestone 7) will re-export from here. Until then
 * we expose the pure math + billing-brain primitives so they can be used and
 * tested directly.
 */

/** The package version, kept in sync with package.json at publish time. */
export const VERSION = "0.1.0";

// ── Public factory (plan §3) ────────────────────────────────────────────────
export { type Billing, createBilling } from "./createBilling.js";

// ── Errors (plan §8) ────────────────────────────────────────────────────────
export { PaystackError, WebhookVerificationError } from "./errors.js";

// ── Types (plan §8) ─────────────────────────────────────────────────────────
export type {
  AnnualRule,
  BillingConfig,
  BillingPolicy,
  CardAuthorization,
  ChargeArgs,
  ChargeResult,
  Currency,
  DunningPolicy,
  HttpOptions,
  Interval,
  Money,
  PlanChange,
  PlanChangeInput,
  ProrationMode,
  RefundArgs,
  RefundResult,
  RenewalPlan,
  Subscription,
  SubscriptionState,
  SubscriptionStatus,
  SubscriptionView,
  TaxPolicy,
  TokenizeArgs,
  TokenizeResult,
} from "./types.js";

// ── Money helpers (plan §5.4) ───────────────────────────────────────────────
export {
  KOBO_PER_NAIRA,
  assertSafeMinor,
  kobo,
  koboToNaira,
  naira,
  nairaToKobo,
} from "./money.js";

// ── Period / interval math (plan §5.3) ──────────────────────────────────────
export { addDays, addInterval, parseISO, periodEnd, toISO } from "./periods.js";

// ── Tax (plan §5.5) ─────────────────────────────────────────────────────────
export { DEFAULT_TAX_POLICY, DEFAULT_TAX_RATE, computeTax } from "./tax.js";

// ── Pricing (plan §5.4 / §4.1) ──────────────────────────────────────────────
export {
  type ComputeAmountOptions,
  computeAmount,
  defaultAnnualRule,
  perIntervalAmount,
} from "./pricing.js";

// ── Deterministic idempotency keys (plan §5.6) ──────────────────────────────
export { IDEMPOTENCY_PREFIX, idempotencyKey } from "./ids.js";

// ── Policy (plan §3) ────────────────────────────────────────────────────────
export {
  DEFAULT_CURRENCY,
  DEFAULT_GRACE_DAYS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_PRORATION,
  type ResolvedPolicy,
  resolveGraceSchedule,
  resolvePolicy,
} from "./policy.js";

// ── Dunning (plan §5.2) ─────────────────────────────────────────────────────
export { applyDunning } from "./dunning.js";

// ── Subscription brain (plan §4.1) ──────────────────────────────────────────
export {
  CHARGEABLE_STATUSES,
  TERMINAL_STATUSES,
  isChargeableStatus,
  isTerminalStatus,
} from "./subscription/stateMachine.js";
export { type ApplyContext, applyResult } from "./subscription/applyResult.js";
export { type RenewalContext, planRenewal } from "./subscription/planRenewal.js";
export { type PlanChangeContext, planChange } from "./subscription/planChange.js";
export { describe, isDue, isTrialing } from "./subscription/describe.js";

// ── Webhook (plan §4.3) ─────────────────────────────────────────────────────
export type { WebhookEvent } from "./types.js";
export {
  type ParsedWebhookEvent,
  type VerifyWebhookArgs,
  computeSignature,
  parseWebhookEvent,
  verifyWebhook,
} from "./webhook.js";
