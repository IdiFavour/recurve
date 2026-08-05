/**
 * Paystack DTOs + explicit typed mappers (plan §6). Paystack speaks snake_case;
 * we map to our camelCase domain types by hand — no generic case-conversion dep.
 */

import type { ChargeResult } from "../../types.js";
import type { PaystackEnvelope } from "./client.js";

/** Subset of Paystack's transaction object we rely on (charge / verify). */
export interface PaystackTransactionData {
  id?: number;
  status?: string; // 'success' | 'failed' | 'abandoned' | 'reversed' | ...
  reference?: string;
  amount?: number;
  currency?: string;
  gateway_response?: string;
}

/** Map a Paystack transaction envelope to our `ChargeResult`. */
export function toChargeResult(
  env: PaystackEnvelope<PaystackTransactionData>,
  fallbackReference: string
): ChargeResult {
  const data = env.data;
  const succeeded = data?.status === "success";
  return {
    status: succeeded ? "success" : "failed",
    reference: data?.reference ?? fallbackReference,
    providerReference: data?.id !== undefined ? String(data.id) : undefined,
    failureReason: succeeded ? undefined : (data?.gateway_response ?? env.message),
    raw: env,
  };
}
