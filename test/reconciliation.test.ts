import { describe, expect, it, vi } from "vitest";
import { idempotencyKey } from "../src/ids.js";
import { resolvePolicy } from "../src/policy.js";
import { PaystackClient } from "../src/providers/paystack/client.js";
import { verifyTransaction } from "../src/providers/paystack/verify.js";
import { applyResult } from "../src/subscription/applyResult.js";
import type { Subscription } from "../src/types.js";

const SECRET = "sk_test_recon";
const PERIOD_END = "2026-08-05T00:00:00.000Z";
const NOW = new Date("2026-08-05T12:00:00.000Z");
const REF = idempotencyKey("sub_recon", PERIOD_END);

function makeSub(over: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub_recon",
    customerRef: "cust_1",
    email: "a@b.com",
    authorizationCode: "AUTH_x",
    planId: "plan_pro",
    amountMinor: 5000,
    interval: "monthly",
    status: "active",
    currentPeriodEnd: PERIOD_END,
    retry: false,
    retryCount: 0,
    ...over,
  };
}

// §11.3: a charge succeeded but the webhook never arrived. The consumer verifies
// the transaction, gets success, and applies it — advancing exactly once even if
// the late webhook (or a re-run) applies the same result again.
describe("missed-webhook reconciliation (§11.3)", () => {
  it("verifyTransaction → applyResult advances once, and is safe to re-apply", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: true,
            message: "Verification successful",
            data: { id: 321, status: "success", reference: REF },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );
    const client = new PaystackClient({
      secretKey: SECRET,
      fetch: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });
    const ctx = { now: NOW, policy: resolvePolicy() };

    const result = await verifyTransaction(client, REF);
    expect(result.status).toBe("success");

    const sub = makeSub();
    const afterReconcile = applyResult(sub, result, ctx);
    expect(afterReconcile.currentPeriodEnd).toBe("2026-09-05T00:00:00.000Z");

    // Late webhook delivers the same charge — must not double-advance.
    const afterLateWebhook = applyResult({ ...sub, ...afterReconcile }, result, ctx);
    expect(afterLateWebhook).toEqual(afterReconcile);
  });
});
