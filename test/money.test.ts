import { describe, expect, it } from "vitest";
import { assertSafeMinor, kobo, koboToNaira, naira, nairaToKobo } from "../src/money.js";

describe("money", () => {
  it("converts naira to kobo", () => {
    expect(nairaToKobo(50)).toBe(5000);
    expect(naira(50)).toBe(5000);
    expect(naira(0)).toBe(0);
  });

  it("converts kobo to naira", () => {
    expect(koboToNaira(5000)).toBe(50);
    expect(kobo(5375)).toBe(53.75);
  });

  it("rounds fractional naira to the nearest kobo", () => {
    // ₦53.755 -> 5375.5 -> rounds to 5376 kobo
    expect(naira(53.755)).toBe(5376);
  });

  it("allows negative integers (proration credits)", () => {
    expect(() => assertSafeMinor(-2500)).not.toThrow();
  });

  it("rejects non-integer minor amounts", () => {
    expect(() => assertSafeMinor(100.5)).toThrow(/integer/);
  });

  it("rejects unsafe integers", () => {
    expect(() => assertSafeMinor(Number.MAX_SAFE_INTEGER + 2)).toThrow(/safe integer/);
  });
});
