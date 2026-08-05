# recurve

**Stateless recurring subscription billing for [Paystack](https://paystack.com).**
recurve gives you the Stripe-style billing engine Paystack lacks natively —
retries/dunning, proration, lifecycle tracking, and clean webhook handling — plus
the plumbing to charge saved cards. It makes network calls to Paystack and does
the billing logic, but it **owns no state**.

> **You own the storage.** recurve is a set of pure functions (current state in →
> next state out) plus typed Paystack API calls. It never opens a database, ships
> a migration, or depends on an ORM. You persist subscriptions and charge attempts
> in whatever database/ORM you already use; recurve tells you *what* to store.

- **Zero runtime dependencies** — native `fetch` (Node 18+) and `node:crypto` only.
- TypeScript-first, ships **ESM + CJS + `.d.ts`**.
- No scheduler, no card vault, no framework coupling. It's a library, not a service.

---

## Install

```bash
npm install @idifavour/recurve
```

Requires **Node.js 18+**.

## Quickstart (charge an already-saved card)

```ts
import { createBilling } from "@idifavour/recurve";

const billing = createBilling({ secretKey: process.env.PAYSTACK_SECRET_KEY! });

const result = await billing.charge({
  authorizationCode: "AUTH_xxxx", // a saved, reusable Paystack authorization
  email: "customer@example.com",
  amountMinor: 500000,            // ₦5,000.00 in kobo (integer minor units)
  reference: "psb_your_unique_ref",
});

console.log(result.status); // "success" | "failed" — never throws
```

## The renewal cron loop

recurve ships **no scheduler** — you trigger renewals on your own cron/queue. The
loop is: find who's due → guard against double-charge → charge → apply the result
→ save. See [`examples/express-cron.ts`](./examples/express-cron.ts).

```ts
import { createBilling } from "@idifavour/recurve";

const billing = createBilling({ secretKey: process.env.PAYSTACK_SECRET_KEY! });

for (const sub of await db.dueSubscriptions(new Date().toISOString())) {
  const plan = billing.planRenewal(sub);
  if (!plan.shouldCharge) continue; // trialing / canceling / not chargeable

  // Money-safety guard: claim the attempt first. The UNIQUE constraint on
  // idempotencyKey means a duplicate insert => already charged => skip.
  if (!(await db.insertChargeAttempt({
    idempotencyKey: plan.idempotencyKey,
    subscriptionId: sub.id,
    amountMinor: plan.amountMinor,
  }))) continue;

  const result = await billing.charge({
    authorizationCode: sub.authorizationCode,
    email: sub.email,
    amountMinor: plan.amountMinor,
    reference: plan.idempotencyKey,          // deterministic reference
    metadata: { subscriptionId: sub.id },
  });

  await db.saveSubscriptionState(sub.id, billing.applyResult(sub, result));
}
```

`applyResult` is the dunning/lifecycle brain: on success it advances the period;
on failure it applies your dunning policy (grace → retry → revoke). It's
idempotent — feeding the same successful charge twice never double-advances.

## Webhook setup (raw body required)

Paystack signs each webhook with **HMAC-SHA512 of the raw request body**, keyed by
your secret key. You **must** capture the raw body — JSON-parsing middleware breaks
the signature. Verification is mandatory; there is no unverified path.
See [`examples/express-webhook.ts`](./examples/express-webhook.ts).

**Express** — use `express.raw()` on the webhook route (not `express.json()`):

```ts
app.post("/webhooks/paystack", express.raw({ type: "*/*" }), async (req, res) => {
  let event;
  try {
    event = billing.verifyWebhook({
      rawBody: req.body,                          // Buffer, from express.raw
      signature: req.header("x-paystack-signature"),
    });
  } catch {
    return res.sendStatus(401);                   // WebhookVerificationError
  }

  const { transaction, subscriptionMetadata } = billing.parseWebhookEvent(event);
  if (transaction && typeof subscriptionMetadata?.subscriptionId === "string") {
    const sub = await loadSubscription(subscriptionMetadata.subscriptionId);
    if (sub) await saveSubscriptionState(sub.id, billing.applyResult(sub, transaction));
  }
  res.sendStatus(200);
});
```

**NestJS** — enable the raw body and read it in your handler:

```ts
// main.ts
const app = await NestFactory.create(AppModule, { rawBody: true });

// controller
@Post("webhooks/paystack")
handle(@Req() req: RawBodyRequest<Request>, @Headers("x-paystack-signature") sig: string) {
  const event = this.billing.verifyWebhook({ rawBody: req.rawBody!, signature: sig });
  // ...parseWebhookEvent + applyResult
}
```

## The storage contract (you persist these)

recurve reads and returns these shapes; you store them with any ORM. **Do not**
generate migrations from this package — adapt these to your schema.

```ts
interface Subscription {
  id: string;                 // your primary key
  customerRef: string;        // your user/account id
  email: string;              // Paystack requires an email per charge
  authorizationCode: string;  // the saved Paystack card token
  planId: string;             // your plan identifier
  amountMinor: number;        // base price in kobo (integer minor units)
  interval: Interval;         // 'daily'|'weekly'|'monthly'|'quarterly'|'annually'
  status: SubscriptionStatus; // see lifecycle below
  currentPeriodEnd: string;   // ISO datetime — the next-charge date
  retry: boolean;             // dunning flag
  retryCount: number;         // dunning attempts used
  trialEndsAt?: string | null;
  cancelAtPeriodEnd?: boolean;
}

interface ChargeAttempt {
  idempotencyKey: string;     // from recurve — PUT A UNIQUE CONSTRAINT ON THIS
  subscriptionId: string;
  amountMinor: number;
  status: "pending" | "success" | "failed";
  providerReference?: string;
  createdAt: string;
}
```

`applyResult` returns only the writable lifecycle subset — `{ status,
currentPeriodEnd, retry, retryCount }` — which you merge back onto your row.

## The idempotency guard (this is how you avoid double charges)

`planRenewal` returns a **deterministic** `idempotencyKey`
(`psb_ + sha256(subscriptionId | periodStart)`): the same subscription-period
always yields the same key. Combined with a **UNIQUE constraint on
`ChargeAttempt.idempotencyKey`**, this is your double-charge guard:

1. Insert the charge attempt **before** charging.
2. If the insert fails (duplicate key), you already charged this period — skip.
3. Pass the same key as Paystack's `reference` for a second layer of protection.

recurve supplies the key; **your unique constraint enforces it.** This is the
primary safety mechanism — don't skip it.

## Subscription lifecycle

```
trialing ──trial ends──▶ active
active   ──charge ok──▶ active (period advanced)
active   ──charge fails──▶ past_due (grace, retry=true)
past_due ──retry ok──▶ active
past_due ──grace elapsed / retries exhausted──▶ revoked
active   ──cancelAtPeriodEnd──▶ canceled ──▶ expired
active   ──pause──▶ paused ──resume──▶ active
```

Statuses: `trialing | active | past_due | paused | canceled | expired | revoked`.

## API reference

Create the client once and reuse it:

```ts
const billing = createBilling({ secretKey, policy?, http? });
```

### Pure decision functions (no network)

| Method | Returns | Description |
|---|---|---|
| `planRenewal(sub)` | `RenewalPlan` | `{ idempotencyKey, amountMinor, currency, periodStart, periodEnd, shouldCharge }` for the due period. `amountMinor` includes annual rule + tax. |
| `applyResult(sub, result)` | `SubscriptionState` | Dunning/lifecycle brain. Success → advance period, clear retry. Failure → grace → retry → revoke. Idempotent per charge. |
| `planChange(sub, newPlan)` | `PlanChange` | Proration. `{ prorationMinor (±), idempotencyKey, effectiveAt, nextState }`. Positive = charge now, negative = credit. |
| `describe(sub, at?)` | `SubscriptionView` | `{ state, nextBillingDate, inGrace, willRenew, isTrialing, isCanceling }`. |
| `isDue(sub, at?)` | `boolean` | Chargeable status AND period ended. Helper — filter in your DB query at scale. |
| `computeAmount(baseMinor, interval)` | `Money` | `{ currency, subtotalMinor, taxMinor, totalMinor }`. Single source of pricing truth. |

### Paystack network functions

| Method | Endpoint | Description |
|---|---|---|
| `charge(args)` | `POST /transaction/charge_authorization` | Charge a saved authorization. **Never throws** — declines/errors return `{ status: "failed" }`. |
| `verifyTransaction(reference)` | `GET /transaction/verify/:reference` | Confirm a charge's true status (webhook-miss reconciliation). |
| `refund(args)` | `POST /refund` | Full (omit amount) or partial refund. |
| `tokenizeCard(args)` | `POST /transaction/initialize` | Optional: collect a new card. Returns `{ checkoutUrl, reference }`. Default fee ₦50, overridable. |
| `captureAuthorization(customerCode)` | `GET /customer/:code` | Returns the first **`reusable === true`** authorization, or `null`. |
| `deactivateAuthorization(code)` | `POST /customer/deactivate_authorization` | "Remove card." |

### Webhook

| Method | Description |
|---|---|
| `verifyWebhook({ rawBody, signature })` | Verifies HMAC-SHA512 (constant-time). Throws `WebhookVerificationError` if invalid. Returns a normalized `WebhookEvent`. |
| `parseWebhookEvent(event)` | Maps to `{ type, subscriptionMetadata, transaction }` — feed `transaction` into `applyResult`. |

## Configuration

```ts
const billing = createBilling({
  secretKey: process.env.PAYSTACK_SECRET_KEY!,   // required; also verifies webhooks
  policy: {
    dunning:   { maxRetries: 1, graceDays: 7 },  // or { retrySchedule: [3, 7] }
    proration: "immediate",                       // 'immediate' | 'next_cycle' | 'none'
    pricing:   { annual: (monthlyMinor) => Math.round((monthlyMinor / 2) * 12) },
    tax:       { rate: 0.075 },                   // NG VAT, or (amountMinor) => taxMinor
    currency:  "NGN",
    tokenization: { amountMinor: 5000 },          // default card-collection fee (₦50)
    clock:     () => new Date(),                  // injectable for deterministic tests
  },
  http: { timeoutMs: 15000, maxRetries: 2 },      // optional transport overrides
});
```

**Dunning** is fully configurable: use `{ maxRetries, graceDays }` for a flat
policy, or `retrySchedule: number[]` for Stripe-like backoff — e.g. `[3, 7]` grants
3 grace days after the first failure, 7 after the second, then revokes.

All amounts are **integer minor units (kobo)**. Use `naira(5000) // → 500000` and
`kobo(500000) // → 5000` helpers. Money math is done on integers, rounded only at
defined points.

## Security

- **Zero runtime dependencies** — smaller supply-chain surface for code that handles
  money and keys.
- Your secret key is **never logged, never put in error messages, and never
  transmitted anywhere but `api.paystack.co`.** No telemetry, no phone-home.
- Webhook verification is mandatory and uses a constant-time signature compare.
- recurve never stores or emits full card numbers — Paystack tokenization keeps you
  out of PAN data.

## License

Source-available under the [PolyForm Shield License 1.0.0](./LICENSE): use it freely,
but you may not offer recurve itself as a competing hosted service.
