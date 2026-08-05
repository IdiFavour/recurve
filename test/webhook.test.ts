import { describe, expect, it } from "vitest";
import { WebhookVerificationError } from "../src/errors.js";
import { idempotencyKey } from "../src/ids.js";
import { resolvePolicy } from "../src/policy.js";
import { applyResult } from "../src/subscription/applyResult.js";
import type { Subscription } from "../src/types.js";
import { computeSignature, parseWebhookEvent, verifyWebhook } from "../src/webhook.js";

const SECRET = "sk_test_webhook_secret";
const PERIOD_END = "2026-08-05T00:00:00.000Z";
const NOW = new Date("2026-08-05T12:00:00.000Z");
const REF = idempotencyKey("sub_wh", PERIOD_END);

function makeSub(over: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub_wh",
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

function eventBody(dataOver: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event: "charge.success",
    data: {
      id: 200,
      status: "success",
      reference: REF,
      gateway_response: "Approved",
      metadata: { subscriptionId: "sub_wh" },
      ...dataOver,
    },
  });
}

describe("verifyWebhook (§11.8)", () => {
  it("accepts a valid signature and normalizes the event", () => {
    const body = eventBody();
    const event = verifyWebhook(SECRET, {
      rawBody: body,
      signature: computeSignature(SECRET, body),
    });
    expect(event.type).toBe("charge.success");
    expect(event.data.reference).toBe(REF);
  });

  it("throws on a tampered body", () => {
    const body = eventBody();
    const signature = computeSignature(SECRET, body);
    const tampered = body.replace("Approved", "Approved-tampered");
    expect(() => verifyWebhook(SECRET, { rawBody: tampered, signature })).toThrow(
      WebhookVerificationError
    );
  });

  it("throws on a wrong signature", () => {
    const body = eventBody();
    expect(() => verifyWebhook(SECRET, { rawBody: body, signature: "deadbeef" })).toThrow(
      WebhookVerificationError
    );
  });

  it("throws when the signature is missing", () => {
    const body = eventBody();
    expect(() => verifyWebhook(SECRET, { rawBody: body, signature: undefined })).toThrow(
      WebhookVerificationError
    );
  });

  it("throws when a valid signature wraps non-JSON", () => {
    const body = "not json";
    expect(() =>
      verifyWebhook(SECRET, { rawBody: body, signature: computeSignature(SECRET, body) })
    ).toThrow(WebhookVerificationError);
  });

  it("verifies a raw Buffer body", () => {
    const body = Buffer.from(eventBody(), "utf8");
    const event = verifyWebhook(SECRET, {
      rawBody: body,
      signature: computeSignature(SECRET, body),
    });
    expect(event.type).toBe("charge.success");
  });
});

describe("parseWebhookEvent", () => {
  it("normalizes a charge.success into a feedable transaction + metadata", () => {
    const body = eventBody();
    const event = verifyWebhook(SECRET, {
      rawBody: body,
      signature: computeSignature(SECRET, body),
    });
    const parsed = parseWebhookEvent(event);
    expect(parsed.type).toBe("charge.success");
    expect(parsed.subscriptionMetadata).toEqual({ subscriptionId: "sub_wh" });
    expect(parsed.transaction).toMatchObject({
      status: "success",
      reference: REF,
      providerReference: "200",
    });
  });

  it("normalizes a failed transaction with its gateway response", () => {
    const body = eventBody({ status: "failed", gateway_response: "Declined" });
    const event = verifyWebhook(SECRET, {
      rawBody: body,
      signature: computeSignature(SECRET, body),
    });
    const parsed = parseWebhookEvent(event);
    expect(parsed.transaction?.status).toBe("failed");
    expect(parsed.transaction?.failureReason).toBe("Declined");
  });
});

describe("webhook replay is idempotent (§11.2)", () => {
  it("applying the same verified event twice advances the period once", () => {
    const ctx = { now: NOW, policy: resolvePolicy() };
    const body = eventBody();
    const event = verifyWebhook(SECRET, {
      rawBody: body,
      signature: computeSignature(SECRET, body),
    });
    const parsed = parseWebhookEvent(event);
    const result = parsed.transaction;
    if (!result) throw new Error("expected a transaction");

    const sub = makeSub();
    const afterFirst = applyResult(sub, result, ctx);
    const afterSecond = applyResult({ ...sub, ...afterFirst }, result, ctx);

    expect(afterFirst.currentPeriodEnd).toBe("2026-09-05T00:00:00.000Z");
    expect(afterSecond).toEqual(afterFirst); // no double-advance
  });
});
