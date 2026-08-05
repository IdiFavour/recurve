import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { IDEMPOTENCY_PREFIX, idempotencyKey } from "../src/ids.js";

// Plan §11.9: same (subscriptionId, periodStart) -> identical key.
describe("idempotency keys (§11.9)", () => {
  const subId = "sub_123";
  const periodStart = "2026-08-01T00:00:00.000Z";

  it("is deterministic for the same subscription + period", () => {
    expect(idempotencyKey(subId, periodStart)).toBe(idempotencyKey(subId, periodStart));
  });

  it("changes when the period changes", () => {
    expect(idempotencyKey(subId, periodStart)).not.toBe(
      idempotencyKey(subId, "2026-09-01T00:00:00.000Z")
    );
  });

  it("changes when the subscription changes", () => {
    expect(idempotencyKey(subId, periodStart)).not.toBe(idempotencyKey("sub_999", periodStart));
  });

  it("uses the psb_ prefix and a 32-char digest slice", () => {
    const key = idempotencyKey(subId, periodStart);
    expect(key.startsWith(IDEMPOTENCY_PREFIX)).toBe(true);
    expect(key).toHaveLength(IDEMPOTENCY_PREFIX.length + 32);
  });

  it("matches the documented construction exactly", () => {
    const expected =
      IDEMPOTENCY_PREFIX +
      createHash("sha256").update(`${subId}|${periodStart}`).digest("hex").slice(0, 32);
    expect(idempotencyKey(subId, periodStart)).toBe(expected);
  });
});
