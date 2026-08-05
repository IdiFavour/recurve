import { beforeEach, describe, expect, it } from "vitest";
import { resolvePolicy } from "../src/policy.js";
import { applyResult } from "../src/subscription/applyResult.js";
import { describe as describeSub, isDue } from "../src/subscription/describe.js";
import { planRenewal } from "../src/subscription/planRenewal.js";
import type { ChargeResult, Subscription } from "../src/types.js";

const PERIOD_END = "2026-08-05T00:00:00.000Z";
const NOW = new Date("2026-08-05T12:00:00.000Z"); // just past the period end → due

function makeSub(over: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub_1",
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

describe("planRenewal", () => {
  const ctx = { now: NOW, policy: resolvePolicy() };

  it("prices the period with annual rule + tax and a deterministic key", () => {
    const plan = planRenewal(makeSub(), ctx);
    expect(plan.amountMinor).toBe(5375); // 5000 + 7.5% VAT
    expect(plan.currency).toBe("NGN");
    expect(plan.periodStart).toBe(PERIOD_END);
    expect(plan.periodEnd).toBe("2026-09-05T00:00:00.000Z");
    expect(plan.idempotencyKey).toBe(planRenewal(makeSub(), ctx).idempotencyKey);
    expect(plan.shouldCharge).toBe(true);
  });

  it("does not charge during an open trial", () => {
    const sub = makeSub({ status: "trialing", trialEndsAt: "2026-09-01T00:00:00.000Z" });
    expect(planRenewal(sub, ctx).shouldCharge).toBe(false);
  });

  it("charges once the trial has ended", () => {
    const sub = makeSub({ status: "trialing", trialEndsAt: "2026-08-01T00:00:00.000Z" });
    expect(planRenewal(sub, ctx).shouldCharge).toBe(true);
  });

  it("does not charge when cancelAtPeriodEnd is set", () => {
    expect(planRenewal(makeSub({ cancelAtPeriodEnd: true }), ctx).shouldCharge).toBe(false);
  });

  it("does not charge a paused subscription", () => {
    expect(planRenewal(makeSub({ status: "paused" }), ctx).shouldCharge).toBe(false);
  });
});

describe("applyResult — double-charge guard (§11.1)", () => {
  const ctx = { now: NOW, policy: resolvePolicy() };

  function successFor(sub: Subscription): ChargeResult {
    return { status: "success", reference: planRenewal(sub, ctx).idempotencyKey };
  }

  it("advances the period exactly once on success", () => {
    const sub = makeSub();
    const state = applyResult(sub, successFor(sub), ctx);
    expect(state).toEqual({
      status: "active",
      currentPeriodEnd: "2026-09-05T00:00:00.000Z",
      retry: false,
      retryCount: 0,
    });
  });

  it("replaying the same success (cron + webhook) does not double-advance", () => {
    const sub = makeSub();
    const success = successFor(sub);

    const afterFirst = applyResult(sub, success, ctx); // cron
    const persisted = { ...sub, ...afterFirst };
    const afterSecond = applyResult(persisted, success, ctx); // webhook replay

    expect(afterSecond.currentPeriodEnd).toBe("2026-09-05T00:00:00.000Z");
    expect(afterSecond).toEqual(afterFirst);
  });

  it("is a pure function of (sub, result): identical input → identical output", () => {
    const sub = makeSub();
    const success = successFor(sub);
    expect(applyResult(sub, success, ctx)).toEqual(applyResult(sub, success, ctx));
  });

  it("ignores a stale success whose reference no longer matches the due period", () => {
    const sub = makeSub();
    const stale: ChargeResult = { status: "success", reference: "psb_totally_wrong" };
    const state = applyResult(sub, stale, ctx);
    expect(state.currentPeriodEnd).toBe(PERIOD_END); // unchanged
    expect(state.status).toBe("active");
  });
});

describe("applyResult — dunning transitions (§11.4)", () => {
  function fail(sub: Subscription, ctx: { now: Date; policy: ReturnType<typeof resolvePolicy> }) {
    const result: ChargeResult = {
      status: "failed",
      reference: planRenewal(sub, ctx).idempotencyKey,
      failureReason: "insufficient_funds",
    };
    return applyResult(sub, result, ctx);
  }

  it("first failure → past_due + 7-day grace + retry=true, retryCount=1", () => {
    const ctx = { now: NOW, policy: resolvePolicy() };
    const state = fail(makeSub(), ctx);
    expect(state).toEqual({
      status: "past_due",
      currentPeriodEnd: "2026-08-12T12:00:00.000Z", // NOW + 7 days
      retry: true,
      retryCount: 1,
    });
  });

  it("second failure after grace (default 1 retry) → revoked, retryCount=2", () => {
    const ctx = { now: NOW, policy: resolvePolicy() };
    const afterFirst = fail(makeSub(), ctx);
    const inGrace = { ...makeSub(), ...afterFirst };
    const state = fail(inGrace, ctx);
    expect(state.status).toBe("revoked");
    expect(state.retry).toBe(false);
    expect(state.retryCount).toBe(2);
  });

  it("supports a multi-retry schedule [3, 7] before revoke", () => {
    const ctx = { now: NOW, policy: resolvePolicy({ dunning: { retrySchedule: [3, 7] } }) };

    const s1 = fail(makeSub(), ctx);
    expect(s1.status).toBe("past_due");
    expect(s1.currentPeriodEnd).toBe("2026-08-08T12:00:00.000Z"); // NOW + 3
    expect(s1.retryCount).toBe(1);

    const s2 = fail({ ...makeSub(), ...s1 }, ctx);
    expect(s2.status).toBe("past_due");
    expect(s2.currentPeriodEnd).toBe("2026-08-12T12:00:00.000Z"); // NOW + 7
    expect(s2.retryCount).toBe(2);

    const s3 = fail({ ...makeSub(), ...s2 }, ctx);
    expect(s3.status).toBe("revoked");
    expect(s3.retryCount).toBe(3);
  });

  it("a recovery charge after past_due returns to active", () => {
    const ctx = { now: NOW, policy: resolvePolicy() };
    const afterFail = fail(makeSub(), ctx);
    const inGrace = { ...makeSub(), ...afterFail };
    const success: ChargeResult = {
      status: "success",
      reference: planRenewal(inGrace, ctx).idempotencyKey,
    };
    const state = applyResult(inGrace, success, ctx);
    expect(state.status).toBe("active");
    expect(state.retry).toBe(false);
    expect(state.retryCount).toBe(0);
  });
});

describe("describe & isDue", () => {
  it("isDue is true for a chargeable, past-period subscription", () => {
    expect(isDue(makeSub(), NOW)).toBe(true);
  });

  it("isDue is false before the period ends", () => {
    expect(isDue(makeSub({ currentPeriodEnd: "2026-12-01T00:00:00.000Z" }), NOW)).toBe(false);
  });

  it("isDue is false for a paused subscription", () => {
    expect(isDue(makeSub({ status: "paused" }), NOW)).toBe(false);
  });

  it("reports in-grace, canceling, and renewal intent", () => {
    expect(describeSub(makeSub({ status: "past_due", retry: true }), NOW).inGrace).toBe(true);

    const canceling = describeSub(makeSub({ cancelAtPeriodEnd: true }), NOW);
    expect(canceling.isCanceling).toBe(true);
    expect(canceling.willRenew).toBe(false);

    expect(describeSub(makeSub(), NOW).willRenew).toBe(true);
  });
});
