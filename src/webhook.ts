/**
 * Webhook verification + normalized parsing (plan §4.3, §6). `node:crypto` only.
 *
 * Paystack signs each webhook with HMAC-SHA512 of the RAW request body, keyed by
 * your secret key, in the `x-paystack-signature` header. Verification is
 * mandatory and uses a constant-time compare (plan §6, §13); there is no bypass.
 *
 * The consumer MUST pass the raw body bytes (not a re-serialized JSON object) —
 * any reordering/whitespace change breaks the HMAC. The README documents the
 * Express (`express.raw`) and NestJS raw-body setup.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookVerificationError } from "./errors.js";
import type { ChargeResult, WebhookEvent } from "./types.js";

export interface VerifyWebhookArgs {
  /** The raw request body bytes/string exactly as received. */
  rawBody: string | Buffer;
  /** The `x-paystack-signature` header value. */
  signature: string | undefined | null;
}

/** The consumer-facing shape produced by `parseWebhookEvent` (plan §4.3). */
export interface ParsedWebhookEvent {
  type: string;
  /** `data.metadata` — the consumer stashes their subscription id here at charge time. */
  subscriptionMetadata?: Record<string, unknown>;
  /** Normalized transaction, ready to feed straight into `applyResult`. */
  transaction?: ChargeResult;
}

/** HMAC-SHA512 hex signature of a raw body, keyed by the secret. */
export function computeSignature(secretKey: string, rawBody: string | Buffer): string {
  return createHmac("sha512", secretKey).update(rawBody).digest("hex");
}

/** Constant-time comparison of two hex-encoded signatures. */
function constantTimeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  // timingSafeEqual requires equal lengths; a length mismatch is a definite fail.
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify a webhook's signature and return a normalized event. Throws
 * `WebhookVerificationError` if the signature is missing/invalid or the body is
 * not JSON — never returns an unverified event.
 */
export function verifyWebhook(secretKey: string, args: VerifyWebhookArgs): WebhookEvent {
  const expected = computeSignature(secretKey, args.rawBody);
  if (!args.signature || !constantTimeEqualHex(expected, args.signature)) {
    throw new WebhookVerificationError();
  }

  const text = typeof args.rawBody === "string" ? args.rawBody : args.rawBody.toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new WebhookVerificationError("Webhook body is not valid JSON");
  }

  const obj = isRecord(parsed) ? parsed : {};
  return {
    type: typeof obj.event === "string" ? obj.event : "",
    data: isRecord(obj.data) ? obj.data : {},
    raw: parsed,
  };
}

/**
 * Map a verified event to the shape the consumer feeds into `applyResult`
 * (plan §4.3). The transaction's `reference` is the idempotency key the charge
 * was made with, so `applyResult`'s guard makes webhook replays idempotent.
 */
export function parseWebhookEvent(event: WebhookEvent): ParsedWebhookEvent {
  const data = event.data;
  const metadata = isRecord(data.metadata) ? data.metadata : undefined;
  const reference = typeof data.reference === "string" ? data.reference : undefined;

  let transaction: ChargeResult | undefined;
  if (reference) {
    const succeeded = data.status === "success";
    transaction = {
      status: succeeded ? "success" : "failed",
      reference,
      providerReference: data.id !== undefined ? String(data.id) : undefined,
      failureReason:
        !succeeded && typeof data.gateway_response === "string" ? data.gateway_response : undefined,
      raw: event.raw,
    };
  }

  return { type: event.type, subscriptionMetadata: metadata, transaction };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
