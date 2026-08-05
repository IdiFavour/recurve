/**
 * Optional card-tokenization helper (plan §4.2) for consumers who don't yet have
 * a saved authorization. Initializes a small `card_collection` charge and returns
 * the Paystack checkout URL; after the customer pays, `captureAuthorization`
 * fetches the resulting reusable authorization.
 */

import type { TokenizeArgs, TokenizeResult } from "../../types.js";
import type { PaystackClient } from "./client.js";

// DECISION (§16.4): default card-collection fee is ₦50 (5000 kobo), overridable
// per call via `args.amountMinor` (and via config in the createBilling factory).
export const DEFAULT_TOKENIZATION_AMOUNT_MINOR = 5000;

interface InitializeData {
  authorization_url?: string;
  reference?: string;
  access_code?: string;
}

export async function tokenizeCard(
  client: PaystackClient,
  args: TokenizeArgs
): Promise<TokenizeResult> {
  const env = await client.post<InitializeData>("/transaction/initialize", {
    email: args.email,
    amount: args.amountMinor ?? DEFAULT_TOKENIZATION_AMOUNT_MINOR,
    reference: args.reference,
    callback_url: args.callbackUrl,
    currency: args.currency,
    metadata: { ...args.metadata, type: "card_collection" },
  });

  return {
    checkoutUrl: env.data?.authorization_url ?? "",
    reference: env.data?.reference ?? args.reference ?? "",
  };
}
