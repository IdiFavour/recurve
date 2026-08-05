---
"@idifavour/recurve": minor
---

Initial release. Stateless recurring subscription billing for Paystack:

- Charge saved authorizations with deterministic idempotency keys.
- Renewal planning (`planRenewal`) with annual-pricing + NG VAT math.
- Dunning brain (`applyResult`): configurable retry schedule → grace → revoke.
- Proration on plan change (`planChange`).
- Lifecycle read-models (`describe`, `isDue`).
- Webhook HMAC-SHA512 verification + normalized parsing.
- Paystack adapter: charge, verify, refund, tokenize, capture (reusable filter),
  deactivate — native `fetch`, zero runtime dependencies.
