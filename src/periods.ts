/**
 * Interval + period math using native `Date` only (plan §5.3). All arithmetic is
 * done in UTC so results are deterministic regardless of the host timezone.
 *
 * Month-length safety: adding a month to Jan 31 clamps to the last day of the
 * target month (Feb 28/29) instead of JS's default overflow into March.
 */

import type { Interval } from "./types.js";

/** Days in a given UTC month (monthIndex is 0-based). */
function daysInMonth(year: number, monthIndex: number): number {
  // Day 0 of the next month === last day of this month.
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Add `months` calendar months to a date, clamping the day to the target month's length. */
function addMonthsClamped(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const monthIndex = date.getUTCMonth();
  const day = date.getUTCDate();

  const absoluteMonth = monthIndex + months;
  const targetYear = year + Math.floor(absoluteMonth / 12);
  const targetMonth = ((absoluteMonth % 12) + 12) % 12;
  const clampedDay = Math.min(day, daysInMonth(targetYear, targetMonth));

  const result = new Date(date.getTime());
  result.setUTCFullYear(targetYear, targetMonth, clampedDay);
  return result;
}

/**
 * Advance a date by `count` intervals. `count` defaults to 1.
 * Pure: returns a new Date, never mutates the input.
 */
export function addInterval(start: Date, interval: Interval, count = 1): Date {
  const d = new Date(start.getTime());
  switch (interval) {
    case "daily":
      d.setUTCDate(d.getUTCDate() + count);
      return d;
    case "weekly":
      d.setUTCDate(d.getUTCDate() + 7 * count);
      return d;
    case "monthly":
      return addMonthsClamped(d, count);
    case "quarterly":
      return addMonthsClamped(d, 3 * count);
    case "annually":
      return addMonthsClamped(d, 12 * count);
  }
}

/** The end of the period that begins at `periodStart` for one `interval`. */
export function periodEnd(periodStart: Date, interval: Interval): Date {
  return addInterval(periodStart, interval, 1);
}

/** Add a whole number of days to a date (used for dunning grace windows). */
export function addDays(start: Date, days: number): Date {
  const d = new Date(start.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Parse an ISO datetime string into a Date, throwing on an invalid value. */
export function parseISO(iso: string): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new RangeError(`Invalid ISO datetime: ${iso}`);
  }
  return d;
}

/** Serialize a Date to an ISO datetime string. */
export function toISO(date: Date): string {
  return date.toISOString();
}
