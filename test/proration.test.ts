import { describe, expect, it } from "vitest";
import { resolvePolicy } from "../src/policy.js";
import { planChange } from "../src/subscription/planChange.js";
import type { Subscription } from "../src/types.js";

// Current period: 2026-08-05 → 2026-09-05 (31 days). NOW is exactly halfway
// (remaining fraction = 0.5) so proration numbers are exact.
const PERIOD_END = "2026-09-05T00:00:00.000Z";
const NOW = new Date("2026-08-20T12:00:00.000Z");

function makeSub(over: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub_pc",
    customerRef: "cust_1",
    email: "a@b.com",
    authorizationCode: "AUTH_x",
    planId: "plan_basic",
    amountMinor: 5000, // total with 7.5% VAT = 5375
    interval: "monthly",
    status: "active",
    currentPeriodEnd: PERIOD_END,
    retry: false,
    retryCount: 0,
    ...over,
  };
}

describe("planChange — proration (§11.7)", () => {
  it("upgrade mid-cycle → positive charge now", () => {
    const ctx = { now: NOW, policy: resolvePolicy() };
    // new total = 10000 + 7.5% = 10750; at 0.5: charge 5375 - credit 2688 = 2687
    const change = planChange(makeSub(), { planId: "plan_pro", amountMinor: 10000 }, ctx);
    expect(change.prorationMinor).toBe(2687);
    expect(change.effectiveAt).toBe("2026-08-20T12:00:00.000Z");
  });

  it("downgrade mid-cycle → negative credit", () => {
    const ctx = { now: NOW, policy: resolvePolicy() };
    // new total = 2000 + 7.5% = 2150; at 0.5: charge 1075 - credit 2688 = -1613
    const change = planChange(makeSub(), { planId: "plan_lite", amountMinor: 2000 }, ctx);
    expect(change.prorationMinor).toBe(-1613);
  });

  it("respects proration = 'next_cycle' (no charge now, effective at period end)", () => {
    const ctx = { now: NOW, policy: resolvePolicy({ proration: "next_cycle" }) };
    const change = planChange(makeSub(), { planId: "plan_pro", amountMinor: 10000 }, ctx);
    expect(change.prorationMinor).toBe(0);
    expect(change.effectiveAt).toBe(PERIOD_END);
  });

  it("respects proration = 'none' (immediate swap, no money)", () => {
    const ctx = { now: NOW, policy: resolvePolicy({ proration: "none" }) };
    const change = planChange(makeSub(), { planId: "plan_pro", amountMinor: 10000 }, ctx);
    expect(change.prorationMinor).toBe(0);
    expect(change.effectiveAt).toBe("2026-08-20T12:00:00.000Z");
  });

  it("produces a deterministic idempotency key", () => {
    const ctx = { now: NOW, policy: resolvePolicy() };
    const a = planChange(makeSub(), { planId: "plan_pro", amountMinor: 10000 }, ctx);
    const b = planChange(makeSub(), { planId: "plan_pro", amountMinor: 10000 }, ctx);
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
    expect(a.idempotencyKey).toMatch(/^psb_/);
  });
});
