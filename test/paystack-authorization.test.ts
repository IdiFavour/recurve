import { describe, expect, it, vi } from "vitest";
import {
  captureAuthorization,
  deactivateAuthorization,
} from "../src/providers/paystack/authorization.js";
import { PaystackClient } from "../src/providers/paystack/client.js";
import { refund } from "../src/providers/paystack/refund.js";
import {
  DEFAULT_TOKENIZATION_AMOUNT_MINOR,
  tokenizeCard,
} from "../src/providers/paystack/tokenize.js";

const SECRET = "sk_test_m6";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeClient(fetchImpl: typeof fetch) {
  return new PaystackClient({
    secretKey: SECRET,
    fetch: fetchImpl,
    sleep: async () => {},
    retryBaseMs: 0,
  });
}

describe("captureAuthorization — reusable filter (§11.5)", () => {
  it("ignores non-reusable authorizations and returns the reusable one", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        status: true,
        message: "Customer retrieved",
        data: {
          authorizations: [
            { authorization_code: "AUTH_single", reusable: false, last4: "0001" },
            {
              authorization_code: "AUTH_reuse",
              reusable: true,
              brand: "visa",
              last4: "4081",
              exp_month: "12",
              exp_year: "2030",
              bank: "Test Bank",
            },
          ],
        },
      })
    );
    const auth = await captureAuthorization(
      makeClient(fetchImpl as unknown as typeof fetch),
      "CUS_x"
    );
    expect(auth).not.toBeNull();
    expect(auth?.authorizationCode).toBe("AUTH_reuse");
    expect(auth?.reusable).toBe(true);
    expect(auth?.last4).toBe("4081");
  });

  it("returns null when no authorization is reusable", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        status: true,
        message: "Customer retrieved",
        data: { authorizations: [{ authorization_code: "AUTH_single", reusable: false }] },
      })
    );
    const auth = await captureAuthorization(
      makeClient(fetchImpl as unknown as typeof fetch),
      "CUS_x"
    );
    expect(auth).toBeNull();
  });
});

describe("deactivateAuthorization", () => {
  it("posts the authorization code", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { status: true, message: "Authorization deactivated", data: {} })
    );
    await deactivateAuthorization(makeClient(fetchImpl as unknown as typeof fetch), "AUTH_reuse");
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ authorization_code: "AUTH_reuse" });
  });
});

describe("tokenizeCard", () => {
  const initData = {
    status: true,
    message: "Authorization URL created",
    data: {
      authorization_url: "https://checkout.paystack.com/abc123",
      reference: "psb_tok",
      access_code: "abc123",
    },
  };

  it("defaults to a ₦50 card_collection charge and returns the checkout URL", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, initData));
    const res = await tokenizeCard(makeClient(fetchImpl as unknown as typeof fetch), {
      email: "a@b.com",
    });
    expect(res.checkoutUrl).toBe("https://checkout.paystack.com/abc123");
    expect(res.reference).toBe("psb_tok");

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.amount).toBe(DEFAULT_TOKENIZATION_AMOUNT_MINOR);
    expect(body.amount).toBe(5000);
    expect(body.metadata.type).toBe("card_collection");
  });

  it("honors a custom amount", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, initData));
    await tokenizeCard(makeClient(fetchImpl as unknown as typeof fetch), {
      email: "a@b.com",
      amountMinor: 10000,
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).amount).toBe(10000);
  });
});

describe("refund", () => {
  it("maps a full refund", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        status: true,
        message: "Refund has been queued for processing",
        data: { status: "pending", amount: 5375, transaction: { reference: "psb_ref" } },
      })
    );
    const res = await refund(makeClient(fetchImpl as unknown as typeof fetch), {
      reference: "psb_ref",
    });
    expect(res.status).toBe("pending");
    expect(res.reference).toBe("psb_ref");
    expect(res.amountMinor).toBe(5375);
  });

  it("sends a partial refund amount as-is", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { status: true, message: "ok", data: { status: "pending" } })
    );
    await refund(makeClient(fetchImpl as unknown as typeof fetch), {
      reference: "psb_ref",
      amountMinor: 2000,
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ transaction: "psb_ref", amount: 2000 });
  });
});
