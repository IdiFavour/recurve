import { describe, expect, it } from "vitest";
import { resolveGraceSchedule, resolvePolicy } from "../src/policy.js";
import { defaultAnnualRule } from "../src/pricing.js";
import { DEFAULT_TAX_POLICY } from "../src/tax.js";

describe("policy resolution", () => {
  it("defaults to 1 retry / 7-day grace", () => {
    expect(resolveGraceSchedule(undefined)).toEqual([7]);
  });

  it("expands {maxRetries, graceDays} into a per-retry schedule", () => {
    expect(resolveGraceSchedule({ maxRetries: 3, graceDays: 5 })).toEqual([5, 5, 5]);
  });

  it("uses an explicit retrySchedule verbatim (Stripe-like backoff)", () => {
    expect(resolveGraceSchedule({ retrySchedule: [3, 7] })).toEqual([3, 7]);
  });

  it("retrySchedule wins over maxRetries/graceDays", () => {
    expect(resolveGraceSchedule({ maxRetries: 9, graceDays: 1, retrySchedule: [2, 4] })).toEqual([
      2, 4,
    ]);
  });

  it("maxRetries 0 means revoke on first failure", () => {
    expect(resolveGraceSchedule({ maxRetries: 0 })).toEqual([]);
  });

  it("fills in every default when policy is omitted", () => {
    const p = resolvePolicy();
    expect(p.dunning.graceScheduleDays).toEqual([7]);
    expect(p.proration).toBe("immediate");
    expect(p.currency).toBe("NGN");
    expect(p.annual).toBe(defaultAnnualRule);
    expect(p.tax).toBe(DEFAULT_TAX_POLICY);
    expect(p.clock()).toBeInstanceOf(Date);
  });

  it("honors overrides", () => {
    const clock = () => new Date("2026-01-01T00:00:00.000Z");
    const p = resolvePolicy({ proration: "none", currency: "USD", clock });
    expect(p.proration).toBe("none");
    expect(p.currency).toBe("USD");
    expect(p.clock()).toEqual(new Date("2026-01-01T00:00:00.000Z"));
  });
});
