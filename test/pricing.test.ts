import { describe, expect, it } from "vitest";
import { computeAmount, defaultAnnualRule, perIntervalAmount } from "../src/pricing.js";
import { computeTax } from "../src/tax.js";

// Plan §11.6: monthly + 7.5% VAT and annual (base/2)*12 must produce exact integer kobo.
describe("pricing & tax (§11.6)", () => {
  const baseMinor = 5000; // ₦50.00

  it("monthly: subtotal passes through, 7.5% VAT, exact integer total", () => {
    const money = computeAmount(baseMinor, { interval: "monthly", currency: "NGN" });
    expect(money).toEqual({
      currency: "NGN",
      subtotalMinor: 5000,
      taxMinor: 375, // round(5000 * 0.075)
      totalMinor: 5375,
    });
  });

  it("annually: applies (base/2)*12 then VAT, exact integer total", () => {
    const money = computeAmount(baseMinor, { interval: "annually", currency: "NGN" });
    expect(money).toEqual({
      currency: "NGN",
      subtotalMinor: 30000, // round((5000 / 2) * 12)
      taxMinor: 2250, // round(30000 * 0.075)
      totalMinor: 32250,
    });
  });

  it("defaultAnnualRule matches (base/2)*12", () => {
    expect(defaultAnnualRule(5000)).toBe(30000);
    expect(defaultAnnualRule(1999)).toBe(Math.round((1999 / 2) * 12)); // 11994
  });

  it("non-annual intervals pass the base through unchanged", () => {
    expect(perIntervalAmount(5000, "weekly")).toBe(5000);
    expect(perIntervalAmount(5000, "quarterly")).toBe(5000);
  });

  it("honors a custom annual rule", () => {
    const money = computeAmount(1000, {
      interval: "annually",
      currency: "NGN",
      annual: (b) => b * 10, // 10 months, "2 free"
      tax: { rate: 0 },
    });
    expect(money.subtotalMinor).toBe(10000);
    expect(money.totalMinor).toBe(10000);
  });

  it("honors a custom tax function", () => {
    expect(computeTax(10000, () => 999)).toBe(999);
  });

  it("rounds VAT once, to an integer", () => {
    // 7.5% of 1333 = 99.975 -> rounds to 100
    expect(computeTax(1333)).toBe(100);
  });

  it("rejects non-integer base amounts", () => {
    expect(() => perIntervalAmount(100.5, "monthly")).toThrow(/integer/);
  });
});
