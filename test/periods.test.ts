import { describe, expect, it } from "vitest";
import { addDays, addInterval, parseISO, periodEnd, toISO } from "../src/periods.js";

const at = (iso: string) => new Date(iso);

describe("periods", () => {
  it("adds daily and weekly intervals", () => {
    expect(toISO(addInterval(at("2026-01-01T00:00:00.000Z"), "daily"))).toBe(
      "2026-01-02T00:00:00.000Z"
    );
    expect(toISO(addInterval(at("2026-01-01T00:00:00.000Z"), "weekly"))).toBe(
      "2026-01-08T00:00:00.000Z"
    );
  });

  it("adds a month and preserves the day + time", () => {
    expect(toISO(periodEnd(at("2026-01-15T09:30:00.000Z"), "monthly"))).toBe(
      "2026-02-15T09:30:00.000Z"
    );
  });

  it("clamps end-of-month when the target month is shorter (Jan 31 -> Feb 28)", () => {
    expect(toISO(periodEnd(at("2026-01-31T00:00:00.000Z"), "monthly"))).toBe(
      "2026-02-28T00:00:00.000Z"
    );
  });

  it("clamps into a leap February (Jan 31 2028 -> Feb 29)", () => {
    expect(toISO(periodEnd(at("2028-01-31T00:00:00.000Z"), "monthly"))).toBe(
      "2028-02-29T00:00:00.000Z"
    );
  });

  it("adds quarterly and annually intervals", () => {
    expect(toISO(periodEnd(at("2026-01-15T00:00:00.000Z"), "quarterly"))).toBe(
      "2026-04-15T00:00:00.000Z"
    );
    expect(toISO(periodEnd(at("2026-01-15T00:00:00.000Z"), "annually"))).toBe(
      "2027-01-15T00:00:00.000Z"
    );
  });

  it("crosses a year boundary for monthly", () => {
    expect(toISO(periodEnd(at("2026-12-10T00:00:00.000Z"), "monthly"))).toBe(
      "2027-01-10T00:00:00.000Z"
    );
  });

  it("does not mutate its input", () => {
    const start = at("2026-01-01T00:00:00.000Z");
    addInterval(start, "monthly");
    expect(toISO(start)).toBe("2026-01-01T00:00:00.000Z");
  });

  it("adds whole days for grace windows", () => {
    expect(toISO(addDays(at("2026-01-01T00:00:00.000Z"), 7))).toBe("2026-01-08T00:00:00.000Z");
  });

  it("parseISO rejects invalid datetimes", () => {
    expect(() => parseISO("not-a-date")).toThrow(/Invalid ISO/);
  });
});
