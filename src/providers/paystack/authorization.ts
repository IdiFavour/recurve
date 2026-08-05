/**
 * Authorization capture + deactivation (plan §4.2, §6, §11.5).
 *
 * `captureAuthorization` fetches a customer and returns their first
 * `reusable === true` authorization — non-reusable (single-use) authorizations
 * are filtered out, because only reusable tokens can drive recurring charges.
 */

import type { CardAuthorization } from "../../types.js";
import type { PaystackClient } from "./client.js";

interface PaystackAuthorization {
  authorization_code?: string;
  reusable?: boolean;
  brand?: string;
  last4?: string;
  exp_month?: string;
  exp_year?: string;
  bank?: string;
}

interface CustomerData {
  authorizations?: PaystackAuthorization[];
}

/**
 * Fetch a customer and return their first reusable authorization, or `null` if
 * none is reusable. GET /customer/:code.
 */
export async function captureAuthorization(
  client: PaystackClient,
  customerCode: string
): Promise<CardAuthorization | null> {
  const env = await client.get<CustomerData>(`/customer/${encodeURIComponent(customerCode)}`);
  const authorizations = env.data?.authorizations ?? [];

  const reusable = authorizations.find(
    (auth) => auth.reusable === true && typeof auth.authorization_code === "string"
  );
  if (!reusable) return null;

  return {
    // biome-ignore lint/style/noNonNullAssertion: guarded by the find predicate above.
    authorizationCode: reusable.authorization_code!,
    reusable: true,
    brand: reusable.brand,
    last4: reusable.last4,
    expMonth: reusable.exp_month,
    expYear: reusable.exp_year,
    bank: reusable.bank,
  };
}

/** Deactivate ("remove") a saved authorization. POST /customer/deactivate_authorization. */
export async function deactivateAuthorization(
  client: PaystackClient,
  authorizationCode: string
): Promise<void> {
  await client.post("/customer/deactivate_authorization", {
    authorization_code: authorizationCode,
  });
}
