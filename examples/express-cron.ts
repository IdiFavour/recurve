/**
 * Example: the renewal cron loop.
 *
 * recurve ships NO scheduler — YOU trigger this on your own cron/queue (e.g. once
 * an hour). It reads due subscriptions from YOUR database, charges them, and
 * saves the returned next-state back. The package never touches your DB.
 *
 * The money-safety guard is the unique constraint on `idempotencyKey`: insert the
 * charge attempt BEFORE charging; if the insert is rejected as a duplicate, this
 * period was already charged, so skip.
 */

import { createBilling } from "@idifavour/recurve";
import type { Subscription, SubscriptionState } from "@idifavour/recurve";

const billing = createBilling({
  secretKey: process.env.PAYSTACK_SECRET_KEY as string,
  // policy is optional; defaults = 1 retry / 7-day grace, NG VAT 7.5%, NGN.
});

// ─── Your storage layer (any ORM). Shown as an interface for illustration. ───
interface Db {
  /** Subscriptions whose currentPeriodEnd <= now and status is chargeable. */
  dueSubscriptions(nowISO: string): Promise<Subscription[]>;
  /** Insert an attempt; returns false if the unique key already exists. */
  insertChargeAttempt(row: {
    idempotencyKey: string;
    subscriptionId: string;
    amountMinor: number;
  }): Promise<boolean>;
  saveSubscriptionState(id: string, state: SubscriptionState): Promise<void>;
}
declare const db: Db;

export async function runRenewals(): Promise<void> {
  const now = new Date();
  const due = await db.dueSubscriptions(now.toISOString());

  for (const sub of due) {
    const plan = billing.planRenewal(sub);
    if (!plan.shouldCharge) continue; // trialing / canceling / not chargeable

    // Money-safety guard: claim the attempt first (unique constraint on the key).
    const claimed = await db.insertChargeAttempt({
      idempotencyKey: plan.idempotencyKey,
      subscriptionId: sub.id,
      amountMinor: plan.amountMinor,
    });
    if (!claimed) continue; // already charged this period — do not double-charge

    // `charge` never throws: declines/errors come back as a failed ChargeResult.
    const result = await billing.charge({
      authorizationCode: sub.authorizationCode,
      email: sub.email,
      amountMinor: plan.amountMinor,
      reference: plan.idempotencyKey, // deterministic reference
      metadata: { subscriptionId: sub.id },
    });

    // The dunning/lifecycle brain: advance on success, grace→retry→revoke on failure.
    const nextState = billing.applyResult(sub, result);
    await db.saveSubscriptionState(sub.id, nextState);
  }
}
