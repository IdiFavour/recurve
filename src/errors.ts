/**
 * Typed errors (plan §8). Kept in a dedicated module so both the Paystack adapter
 * and the webhook layer can import them without cycles.
 *
 * Security (plan §6, §13): error messages/raw payloads must never contain the
 * secret key. The Paystack client redacts before constructing these.
 */

/** Wraps a Paystack API/transport failure with its HTTP status and safe payload. */
export class PaystackError extends Error {
  /** HTTP status code (0 for network/timeout errors). */
  readonly status: number;
  /** The parsed Paystack response body, if any. Never contains the secret key. */
  readonly raw?: unknown;

  constructor(message: string, opts: { status: number; raw?: unknown }) {
    super(message);
    this.name = "PaystackError";
    this.status = opts.status;
    this.raw = opts.raw;
  }
}

/** Thrown when a webhook signature fails HMAC verification (plan §4.3). */
export class WebhookVerificationError extends Error {
  constructor(message = "Webhook signature verification failed") {
    super(message);
    this.name = "WebhookVerificationError";
  }
}
