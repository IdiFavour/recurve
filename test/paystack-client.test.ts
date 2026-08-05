import { describe, expect, it, vi } from "vitest";
import { PaystackError } from "../src/errors.js";
import { charge } from "../src/providers/paystack/charge.js";
import { PaystackClient } from "../src/providers/paystack/client.js";
import { verifyTransaction } from "../src/providers/paystack/verify.js";

const SECRET = "sk_test_SUPERSECRET_should_never_leak";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeClient(fetchImpl: typeof fetch, over: Record<string, unknown> = {}) {
  return new PaystackClient({
    secretKey: SECRET,
    fetch: fetchImpl,
    sleep: async () => {},
    retryBaseMs: 0,
    ...over,
  });
}

const okTxn = (over: Record<string, unknown> = {}) =>
  jsonResponse(200, {
    status: true,
    message: "Charge attempted",
    data: {
      id: 99,
      status: "success",
      reference: "psb_ref",
      gateway_response: "Approved",
      ...over,
    },
  });

describe("PaystackClient — transient retry (§11.10)", () => {
  it("retries 5xx up to maxRetries then succeeds", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls < 3
        ? jsonResponse(503, { status: false, message: "service unavailable" })
        : okTxn();
    });
    const client = makeClient(fetchImpl as unknown as typeof fetch);

    const env = await client.request("GET", "/x");
    expect(env.status).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("throws PaystackError after exhausting retries on persistent 5xx", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, { status: false, message: "boom" }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.request("GET", "/x")).rejects.toBeInstanceOf(PaystackError);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry a 4xx (deterministic client error)", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(400, { status: false, message: "bad request" })
    );
    const client = makeClient(fetchImpl as unknown as typeof fetch);

    await expect(client.request("GET", "/x")).rejects.toMatchObject({ status: 400 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries network/timeout errors as transient", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls < 2) throw new Error("network down");
      return okTxn();
    });
    const client = makeClient(fetchImpl as unknown as typeof fetch);

    const env = await client.request("GET", "/x");
    expect(env.status).toBe(true);
    expect(calls).toBe(2);
  });

  it("sends Bearer auth and a JSON body", async () => {
    const fetchImpl = vi.fn(async () => okTxn());
    const client = makeClient(fetchImpl as unknown as typeof fetch);

    await client.post("/thing", { a: 1 });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });
});

describe("PaystackClient — secret never leaks (§11.10, §13)", () => {
  it("redacts the secret from API error messages", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(500, { status: false, message: `failure near ${SECRET}` })
    );
    const client = makeClient(fetchImpl as unknown as typeof fetch);

    const err = await client.request("GET", "/x").catch((e) => e);
    expect(err).toBeInstanceOf(PaystackError);
    expect(err.message).not.toContain(SECRET);
  });

  it("redacts the secret from network error messages", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`connect ECONNREFUSED using ${SECRET}`);
    });
    const client = makeClient(fetchImpl as unknown as typeof fetch);

    const err = await client.request("GET", "/x").catch((e) => e);
    expect(err).toBeInstanceOf(PaystackError);
    expect(err.message).not.toContain(SECRET);
  });
});

describe("charge — never throws, maps result (§7.5)", () => {
  const args = {
    authorizationCode: "AUTH_x",
    email: "a@b.com",
    amountMinor: 5375,
    reference: "psb_ref",
  };

  it("maps a successful charge", async () => {
    const fetchImpl = vi.fn(async () => okTxn());
    const client = makeClient(fetchImpl as unknown as typeof fetch);

    const res = await charge(client, args);
    expect(res.status).toBe("success");
    expect(res.reference).toBe("psb_ref");
    expect(res.providerReference).toBe("99");
  });

  it("sends the amount in kobo as-is and the reference", async () => {
    const fetchImpl = vi.fn(async () => okTxn());
    const client = makeClient(fetchImpl as unknown as typeof fetch);

    await charge(client, args);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.amount).toBe(5375);
    expect(body.reference).toBe("psb_ref");
    expect(body.authorization_code).toBe("AUTH_x");
  });

  it("maps a decline (200 + status:failed) to a failed result, not a throw", async () => {
    const fetchImpl = vi.fn(async () =>
      okTxn({ status: "failed", gateway_response: "Insufficient funds" })
    );
    const client = makeClient(fetchImpl as unknown as typeof fetch);

    const res = await charge(client, args);
    expect(res.status).toBe("failed");
    expect(res.failureReason).toBe("Insufficient funds");
  });

  it("surfaces an API error (401) as a failed result, never throwing", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(401, { status: false, message: "Invalid key" })
    );
    const client = makeClient(fetchImpl as unknown as typeof fetch);

    const res = await charge(client, args);
    expect(res.status).toBe("failed");
    expect(res.reference).toBe("psb_ref");
    expect(res.failureReason).toContain("Invalid key");
    expect(res.failureReason).not.toContain(SECRET);
  });
});

describe("verifyTransaction", () => {
  it("maps a verified success", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        status: true,
        message: "Verification successful",
        data: { id: 5, status: "success", reference: "psb_ref" },
      })
    );
    const client = makeClient(fetchImpl as unknown as typeof fetch);

    const res = await verifyTransaction(client, "psb_ref");
    expect(res.status).toBe("success");
    expect(res.reference).toBe("psb_ref");
  });
});
