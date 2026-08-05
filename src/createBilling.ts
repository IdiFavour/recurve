/**
 * `createBilling` — the public factory (plan §3, §4). Wires the pure billing
 * brain and the Paystack adapter into one object:
 *  - pure methods close over the resolved policy and the injectable clock;
 *  - network methods share a single `PaystackClient`;
 *  - webhook methods use the same `secretKey` (Paystack signs webhooks with it).
 *
 * Statelessness (plan §1, §15): this holds config + an HTTP client only. It opens
 * no database, ships no scheduler, and persists nothing.
 */

import { resolvePolicy } from "./policy.js";
import { computeAmount as computeAmountCore } from "./pricing.js";
import {
  captureAuthorization as captureAuthorizationCore,
  deactivateAuthorization as deactivateAuthorizationCore,
} from "./providers/paystack/authorization.js";
import { charge as chargeCore } from "./providers/paystack/charge.js";
import { PaystackClient } from "./providers/paystack/client.js";
import { refund as refundCore } from "./providers/paystack/refund.js";
import { tokenizeCard as tokenizeCardCore } from "./providers/paystack/tokenize.js";
import { DEFAULT_TOKENIZATION_AMOUNT_MINOR } from "./providers/paystack/tokenize.js";
import { verifyTransaction as verifyTransactionCore } from "./providers/paystack/verify.js";
import { applyResult as applyResultCore } from "./subscription/applyResult.js";
import { describe as describeCore, isDue as isDueCore } from "./subscription/describe.js";
import { planChange as planChangeCore } from "./subscription/planChange.js";
import { planRenewal as planRenewalCore } from "./subscription/planRenewal.js";
import type {
  BillingConfig,
  CardAuthorization,
  ChargeArgs,
  ChargeResult,
  Interval,
  Money,
  PlanChange,
  PlanChangeInput,
  RefundArgs,
  RefundResult,
  RenewalPlan,
  Subscription,
  SubscriptionState,
  SubscriptionView,
  TokenizeArgs,
  TokenizeResult,
  WebhookEvent,
} from "./types.js";
import {
  type ParsedWebhookEvent,
  type VerifyWebhookArgs,
  parseWebhookEvent as parseWebhookEventCore,
  verifyWebhook as verifyWebhookCore,
} from "./webhook.js";

/** The object returned by `createBilling`. Grouped per plan §4. */
export interface Billing {
  // ── Pure decision functions (no network) — plan §4.1 ──
  planRenewal(sub: Subscription): RenewalPlan;
  applyResult(sub: Subscription, result: ChargeResult): SubscriptionState;
  planChange(sub: Subscription, newPlan: PlanChangeInput): PlanChange;
  describe(sub: Subscription, at?: Date): SubscriptionView;
  isDue(sub: Subscription, at?: Date): boolean;
  computeAmount(baseMinor: number, interval: Interval): Money;

  // ── Paystack network functions — plan §4.2 ──
  charge(args: ChargeArgs): Promise<ChargeResult>;
  verifyTransaction(reference: string): Promise<ChargeResult>;
  refund(args: RefundArgs): Promise<RefundResult>;
  tokenizeCard(args: TokenizeArgs): Promise<TokenizeResult>;
  captureAuthorization(customerCode: string): Promise<CardAuthorization | null>;
  deactivateAuthorization(authorizationCode: string): Promise<void>;

  // ── Webhook — plan §4.3 ──
  verifyWebhook(args: VerifyWebhookArgs): WebhookEvent;
  parseWebhookEvent(event: WebhookEvent): ParsedWebhookEvent;
}

export function createBilling(config: BillingConfig): Billing {
  if (!config.secretKey) {
    throw new Error("createBilling: `secretKey` is required");
  }

  const policy = resolvePolicy(config.policy);
  const client = new PaystackClient({ secretKey: config.secretKey, ...config.http });

  const tokenizationAmountMinor =
    config.policy?.tokenization?.amountMinor ?? DEFAULT_TOKENIZATION_AMOUNT_MINOR;

  const ctx = () => ({ now: policy.clock(), policy });

  return {
    // Pure
    planRenewal: (sub) => planRenewalCore(sub, ctx()),
    applyResult: (sub, result) => applyResultCore(sub, result, ctx()),
    planChange: (sub, newPlan) => planChangeCore(sub, newPlan, ctx()),
    describe: (sub, at) => describeCore(sub, at ?? policy.clock()),
    isDue: (sub, at) => isDueCore(sub, at ?? policy.clock()),
    computeAmount: (baseMinor, interval) =>
      computeAmountCore(baseMinor, {
        interval,
        currency: policy.currency,
        annual: policy.annual,
        tax: policy.tax,
      }),

    // Network
    charge: (args) => chargeCore(client, args),
    verifyTransaction: (reference) => verifyTransactionCore(client, reference),
    refund: (args) => refundCore(client, args),
    tokenizeCard: (args) =>
      tokenizeCardCore(client, {
        ...args,
        amountMinor: args.amountMinor ?? tokenizationAmountMinor,
      }),
    captureAuthorization: (customerCode) => captureAuthorizationCore(client, customerCode),
    deactivateAuthorization: (authorizationCode) =>
      deactivateAuthorizationCore(client, authorizationCode),

    // Webhook — same secretKey signs webhooks (plan §3)
    verifyWebhook: (args) => verifyWebhookCore(config.secretKey, args),
    parseWebhookEvent: (event) => parseWebhookEventCore(event),
  };
}
