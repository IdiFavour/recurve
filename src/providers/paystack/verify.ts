/**
 * Verify a transaction's true status (plan §4.2): GET /transaction/verify/:reference.
 *
 * Used in the webhook-miss reconciliation path (plan §11.3). Unlike `charge`,
 * this may throw `PaystackError` on an API/transport failure — the consumer's
 * reconciliation code decides how to handle a failed lookup.
 */

import type { ChargeResult } from "../../types.js";
import type { PaystackClient } from "./client.js";
import { type PaystackTransactionData, toChargeResult } from "./types.js";

export async function verifyTransaction(
  client: PaystackClient,
  reference: string
): Promise<ChargeResult> {
  const env = await client.get<PaystackTransactionData>(
    `/transaction/verify/${encodeURIComponent(reference)}`
  );
  return toChargeResult(env, reference);
}
