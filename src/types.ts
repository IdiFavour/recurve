/**
 * Shared, exported types (plan §8). This is the single home for the domain
 * shapes; runtime code (money/periods/pricing/tax/subscription/*) imports these.
 * Network/webhook DTOs that only matter to later milestones are added when those
 * milestones land, to keep each milestone's surface honest.
 */

/** Paystack-supported billing intervals. See plan §5.3. */
export type Interval = "daily" | "weekly" | "monthly" | "quarterly" | "annually";

/** Paystack-settlement currencies. NGN is the default for this package. */
export type Currency = "NGN" | "USD" | "GHS" | "ZAR" | "KES";

/**
 * The result of pricing math. All fields are integer minor units (kobo for NGN).
 * `totalMinor` is what actually gets charged. See plan §5.4 / §5.5.
 */
export interface Money {
  currency: Currency;
  /** Price for the period after the annual rule, before tax. */
  subtotalMinor: number;
  /** Tax applied to the subtotal (NG VAT by default). */
  taxMinor: number;
  /** subtotalMinor + taxMinor — the amount sent to Paystack. */
  totalMinor: number;
}

/** Maps a base (monthly-reference) minor price to the annual minor price (plan §5.4). */
export type AnnualRule = (baseMinor: number) => number;

/** Either a flat rate or a fully custom tax function over minor units (plan §5.5). */
export type TaxPolicy = { rate: number } | ((amountMinor: number) => number);

/** How mid-cycle plan changes are billed (plan §4.1). */
export type ProrationMode = "immediate" | "next_cycle" | "none";

/** Subscription lifecycle states (plan §5.1). */
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "paused"
  | "canceled"
  | "expired"
  | "revoked";

/**
 * The consumer's stored subscription row (plan §2). The package reads this and
 * returns the next writable fields; the consumer persists it in their own DB.
 */
export interface Subscription {
  id: string;
  customerRef: string;
  email: string;
  authorizationCode: string;
  planId: string;
  /** Base price in minor units (kobo). */
  amountMinor: number;
  interval: Interval;
  status: SubscriptionStatus;
  /** ISO datetime — the next-charge date / current period boundary. */
  currentPeriodEnd: string;
  retry: boolean;
  retryCount: number;
  trialEndsAt?: string | null;
  cancelAtPeriodEnd?: boolean;
}

/** The writable subset returned by `applyResult` — exactly the fields it changes (plan §8). */
export interface SubscriptionState {
  status: SubscriptionStatus;
  currentPeriodEnd: string;
  retry: boolean;
  retryCount: number;
}

/** Output of `planRenewal` (plan §4.1). */
export interface RenewalPlan {
  idempotencyKey: string;
  amountMinor: number;
  currency: Currency;
  /** ISO datetime — start of the period being charged. */
  periodStart: string;
  /** ISO datetime — end of the period being charged. */
  periodEnd: string;
  shouldCharge: boolean;
}

/** The target plan for a `planChange` (plan §4.1). */
export interface PlanChangeInput {
  planId: string;
  /** New base price in minor units (kobo). */
  amountMinor: number;
  /** New interval; defaults to the subscription's current interval. */
  interval?: Interval;
}

/** Output of `planChange` — proration (plan §4.1). */
export interface PlanChange {
  /** Positive = charge now, negative = credit. Minor units. */
  prorationMinor: number;
  idempotencyKey: string;
  /** ISO datetime the change takes effect. */
  effectiveAt: string;
  nextState: SubscriptionState;
}

/** A reusable saved card authorization (plan §2). `reusable` is always true here. */
export interface CardAuthorization {
  authorizationCode: string;
  reusable: boolean;
  brand?: string;
  last4?: string;
  expMonth?: string;
  expYear?: string;
  bank?: string;
}

/** Arguments to tokenize a brand-new card (plan §4.2). */
export interface TokenizeArgs {
  email: string;
  /** Card-collection charge in minor units. Defaults to ₦50 (plan §4.2 / DECISION §16.4). */
  amountMinor?: number;
  reference?: string;
  callbackUrl?: string;
  currency?: Currency;
  metadata?: Record<string, unknown>;
}

/** Result of `tokenizeCard` (plan §4.2). */
export interface TokenizeResult {
  checkoutUrl: string;
  reference: string;
}

/** Arguments to refund a transaction (plan §4.2). */
export interface RefundArgs {
  reference: string;
  /** Omit for a full refund; provide for a partial refund. Minor units. */
  amountMinor?: number;
}

/** Result of `refund` (plan §4.2). */
export interface RefundResult {
  status: string;
  reference: string;
  amountMinor?: number;
  raw: unknown;
}

/** Read-model for tracking/UI (plan §4.1). Pure interpretation of stored state. */
export interface SubscriptionView {
  state: SubscriptionStatus;
  nextBillingDate: string;
  inGrace: boolean;
  willRenew: boolean;
  isTrialing: boolean;
  isCanceling: boolean;
}

/** Arguments to charge a saved authorization (plan §4.2). */
export interface ChargeArgs {
  /** The saved Paystack card token. */
  authorizationCode: string;
  email: string;
  /** Amount in minor units (kobo) — sent to Paystack as-is (plan §5.4). */
  amountMinor: number;
  /** Should be the deterministic idempotency key (plan §7.2). */
  reference: string;
  currency?: Currency;
  metadata?: Record<string, unknown>;
}

/** The result of a charge attempt (plan §8). Failure is data, never a throw (§7.5). */
export interface ChargeResult {
  status: "success" | "failed";
  /** The idempotency key used as the Paystack `reference`. */
  reference: string;
  /** Paystack transaction reference/id, when available. */
  providerReference?: string;
  failureReason?: string;
  /** The raw Paystack payload, for the consumer's records. */
  raw?: unknown;
}

/** A verified, minimally-normalized Paystack webhook event (plan §4.3). */
export interface WebhookEvent {
  /** Paystack event name, e.g. "charge.success". */
  type: string;
  /** The event's `data` payload (transaction / subscription / etc.). */
  data: Record<string, unknown>;
  /** The full parsed event body, for the consumer's records. */
  raw: unknown;
}

/** Dunning configuration (plan §5.2). All fields optional; see defaults in policy.ts. */
export interface DunningPolicy {
  /** Number of retries before revoke. Default 1. Ignored when `retrySchedule` is set. */
  maxRetries?: number;
  /** Grace days granted per retry. Default 7. Ignored when `retrySchedule` is set. */
  graceDays?: number;
  /**
   * Explicit per-retry grace windows in days (Stripe-like backoff). When present,
   * its length is the retry count and each entry is that attempt's grace window,
   * e.g. `[3, 7]` = 3 days after the first failure, 7 after the second, then revoke.
   */
  retrySchedule?: number[];
}

/** User-supplied policy (plan §3). Every field is optional and falls back to a default. */
export interface BillingPolicy {
  dunning?: DunningPolicy;
  proration?: ProrationMode;
  pricing?: { annual?: AnnualRule };
  tax?: TaxPolicy;
  currency?: Currency;
  /** Default card-collection fee for `tokenizeCard` (minor units). Defaults to ₦50. */
  tokenization?: { amountMinor?: number };
  /** Injectable clock for deterministic tests. */
  clock?: () => Date;
}

/** Optional HTTP transport overrides (plan §6). Advanced: proxies, timeouts, tests. */
export interface HttpOptions {
  baseUrl?: string;
  timeoutMs?: number;
  /** Transient retries for 5xx/network errors. Default 2. */
  maxRetries?: number;
  retryBaseMs?: number;
  /** Injectable fetch (e.g. for tests or a custom agent). Defaults to global fetch. */
  fetch?: typeof fetch;
}

/** Config passed to `createBilling` (plan §3). */
export interface BillingConfig {
  /** The consumer's Paystack secret key. Never logged, never sent anywhere but Paystack. */
  secretKey: string;
  policy?: BillingPolicy;
  http?: HttpOptions;
}
