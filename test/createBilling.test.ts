import { describe, expect, it, vi } from "vitest";
import { createBilling } from "../src/createBilling.js";
import { WebhookVerificationError } from "../src/errors.js";
import { idempotencyKey } from "../src/ids.js";
import type { Subscription } from "../src/types.js";
import { computeSignature } from "../src/webhook.js";

const SECRET = "sk_test_factory";
const PERIOD_END = "2026-08-05T00:00:00.000Z";
const FIXED_NOW = new Date("2026-08-05T12:00:00.000Z");

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeSub(over: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub_f",
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

function makeBilling(fetchImpl?: typeof fetch) {
  return createBilling({
    secretKey: SECRET,
    policy: { clock: () => FIXED_NOW },
    http: fetchImpl ? { fetch: fetchImpl } : undefined,
  });
}

describe("createBilling — config", () => {
  it("throws when secretKey is missing", () => {
    // @ts-expect-error deliberately omitting secretKey
    expect(() => createBilling({})).toThrow(/secretKey/);
  });
});

describe("createBilling — pure methods use the injected clock + policy", () => {
  const billing = makeBilling();

  it("computeAmount applies annual rule + VAT", () => {
    expect(billing.computeAmount(5000, "monthly")).toEqual({
      currency: "NGN",
      subtotalMinor: 5000,
      taxMinor: 375,
      totalMinor: 5375,
    });
  });

  it("planRenewal + applyResult round-trip advances once", () => {
    const sub = makeSub();
    const plan = billing.planRenewal(sub);
    expect(plan.amountMinor).toBe(5375);
    expect(plan.idempotencyKey).toBe(idempotencyKey(sub.id, PERIOD_END));

    const state = billing.applyResult(sub, { status: "success", reference: plan.idempotencyKey });
    expect(state.currentPeriodEnd).toBe("2026-09-05T00:00:00.000Z");
  });

  it("isDue uses the injected clock", () => {
    expect(billing.isDue(makeSub())).toBe(true);
    expect(billing.isDue(makeSub({ currentPeriodEnd: "2026-12-01T00:00:00.000Z" }))).toBe(false);
  });
});

describe("createBilling — network methods share one client", () => {
  it("charge maps a success via the injected fetch", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        status: true,
        message: "Charge attempted",
        data: { id: 42, status: "success", reference: "psb_ref" },
      })
    );
    const billing = makeBilling(fetchImpl as unknown as typeof fetch);

    const res = await billing.charge({
      authorizationCode: "AUTH_x",
      email: "a@b.com",
      amountMinor: 5375,
      reference: "psb_ref",
    });
    expect(res.status).toBe("success");
    expect(res.providerReference).toBe("42");

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/transaction/charge_authorization");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
  });

  it("tokenizeCard defaults the fee from config", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        status: true,
        message: "ok",
        data: { authorization_url: "https://checkout/x", reference: "psb_tok" },
      })
    );
    const billing = createBilling({
      secretKey: SECRET,
      policy: { tokenization: { amountMinor: 7500 } },
      http: { fetch: fetchImpl as unknown as typeof fetch },
    });

    await billing.tokenizeCard({ email: "a@b.com" });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).amount).toBe(7500);
  });
});

describe("createBilling — webhook uses the same secretKey", () => {
  it("verifies a webhook signed with the secret key", () => {
    const billing = makeBilling();
    const body = JSON.stringify({
      event: "charge.success",
      data: { status: "success", reference: "psb_ref", metadata: { subscriptionId: "sub_f" } },
    });
    const event = billing.verifyWebhook({
      rawBody: body,
      signature: computeSignature(SECRET, body),
    });
    expect(event.type).toBe("charge.success");

    const parsed = billing.parseWebhookEvent(event);
    expect(parsed.transaction?.reference).toBe("psb_ref");
  });

  it("rejects a bad signature", () => {
    const billing = makeBilling();
    expect(() => billing.verifyWebhook({ rawBody: "{}", signature: "bad" })).toThrow(
      WebhookVerificationError
    );
  });
});
