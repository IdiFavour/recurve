/**
 * Charge a saved authorization (plan §4.2): POST /transaction/charge_authorization.
 *
 * Per §7.5, a charge NEVER throws out of the consumer's renewal loop: any API,
 * network, or decline outcome is surfaced as a `ChargeResult` with
 * `status: 'failed'`, which the consumer feeds straight into `applyResult`.
 */

import { PaystackError } from "../../errors.js";
import type { ChargeArgs, ChargeResult } from "../../types.js";
import type { PaystackClient } from "./client.js";
import { type PaystackTransactionData, toChargeResult } from "./types.js";

const ENDPOINT = "/transaction/charge_authorization";

export async function charge(client: PaystackClient, args: ChargeArgs): Promise<ChargeResult> {
  try {
    const env = await client.post<PaystackTransactionData>(ENDPOINT, {
      authorization_code: args.authorizationCode,
      email: args.email,
      amount: args.amountMinor, // kobo, sent as-is (plan §5.4)
      reference: args.reference, // deterministic idempotency key (plan §7.2)
      currency: args.currency,
      metadata: args.metadata,
    });
    return toChargeResult(env, args.reference);
  } catch (err) {
    return {
      status: "failed",
      reference: args.reference,
      failureReason: err instanceof Error ? err.message : "charge failed",
      raw: err instanceof PaystackError ? err.raw : undefined,
    };
  }
}
