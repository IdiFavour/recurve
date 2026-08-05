/**
 * Refund a transaction (plan §4.2): POST /refund. Full refund when `amountMinor`
 * is omitted, partial when provided (minor units, sent to Paystack as-is).
 */

import type { RefundArgs, RefundResult } from "../../types.js";
import type { PaystackClient } from "./client.js";

interface RefundData {
  status?: string;
  amount?: number;
  transaction?: { reference?: string };
}

export async function refund(client: PaystackClient, args: RefundArgs): Promise<RefundResult> {
  const env = await client.post<RefundData>("/refund", {
    transaction: args.reference,
    amount: args.amountMinor,
  });

  return {
    status: env.data?.status ?? (env.status ? "pending" : "failed"),
    reference: env.data?.transaction?.reference ?? args.reference,
    amountMinor: env.data?.amount,
    raw: env,
  };
}
