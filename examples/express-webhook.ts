/**
 * Example: Paystack webhook handler (Express).
 *
 * CRITICAL: the HMAC is computed over the RAW request body. You MUST use
 * `express.raw()` on this route — do NOT let `express.json()` parse it first, or
 * the signature will never match. NestJS: enable `rawBody: true` and read
 * `req.rawBody`.
 *
 * `applyResult` is idempotent, so a webhook re-delivery (or a webhook that races
 * your cron) will not double-advance the subscription.
 */

import express from "express";
import { createBilling } from "@idifavour/recurve";
import type { Subscription, SubscriptionState } from "@idifavour/recurve";

const billing = createBilling({ secretKey: process.env.PAYSTACK_SECRET_KEY as string });
const app = express();

app.post(
  "/webhooks/paystack",
  express.raw({ type: "*/*" }), // req.body is a Buffer
  async (req, res) => {
    let event: ReturnType<typeof billing.verifyWebhook>;
    try {
      event = billing.verifyWebhook({
        rawBody: req.body,
        signature: req.header("x-paystack-signature"),
      });
    } catch {
      res.sendStatus(401); // WebhookVerificationError — reject unverified events
      return;
    }

    const { transaction, subscriptionMetadata } = billing.parseWebhookEvent(event);
    const subscriptionId = subscriptionMetadata?.subscriptionId;

    if (transaction && typeof subscriptionId === "string") {
      const sub = await loadSubscription(subscriptionId);
      if (sub) {
        const next = billing.applyResult(sub, transaction); // idempotent on replay
        await saveSubscriptionState(sub.id, next);
      }
    }

    res.sendStatus(200);
  }
);

// ─── Your storage layer (any ORM). ───
declare function loadSubscription(id: string): Promise<Subscription | null>;
declare function saveSubscriptionState(id: string, state: SubscriptionState): Promise<void>;

app.listen(3000);
