/**
 * Paystack HTTP client (plan §6). Native `fetch` only — no runtime deps.
 *
 * Responsibilities:
 *  - Bearer auth with the consumer's secret key.
 *  - A per-request timeout via `AbortController` (default 15s).
 *  - A small transient retry (default 2) for 5xx and network/timeout errors ONLY.
 *    This is HTTP-layer retry, wholly separate from subscription dunning (§6).
 *    4xx responses are never retried.
 *  - Redacting the secret key out of every error it throws (§6, §13).
 *
 * The transient retry is safe for charges because every charge carries the
 * deterministic idempotency key as its `reference` (plan §7.2), so a retried
 * request cannot double-charge.
 */

import { PaystackError } from "../../errors.js";

const DEFAULT_BASE_URL = "https://api.paystack.co";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 200;

export interface PaystackClientOptions {
  secretKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  /** Transient retries for 5xx/network errors. Default 2. */
  maxRetries?: number;
  /** Base backoff in ms; each retry waits `base * 2^(attempt-1)`. Default 200. */
  retryBaseMs?: number;
  /** Injectable for tests. Defaults to global `fetch`. */
  fetch?: typeof fetch;
  /** Injectable for tests to avoid real delays. */
  sleep?: (ms: number) => Promise<void>;
}

export interface PaystackEnvelope<T = unknown> {
  status: boolean;
  message: string;
  data: T;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class PaystackClient {
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: PaystackClientOptions) {
    this.secretKey = opts.secretKey;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseMs = opts.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.sleep = opts.sleep ?? defaultSleep;
    if (typeof this.fetchImpl !== "function") {
      throw new Error("global fetch is unavailable; Node 18+ is required");
    }
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<PaystackEnvelope<T>> {
    const url = `${this.baseUrl}${path}`;
    let lastError: PaystackError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await this.sleep(this.retryBaseMs * 2 ** (attempt - 1));

      let res: Response;
      try {
        res = await this.fetchWithTimeout(url, method, body);
      } catch (err) {
        // Network error or timeout/abort → transient, retry.
        lastError = this.networkError(err);
        continue;
      }

      const text = await res.text().catch(() => "");
      const env = this.parseBody<T>(text);

      if (res.ok) {
        return env ?? { status: true, message: "", data: undefined as T };
      }

      const apiError = this.apiError(res.status, env, res.statusText);
      if (res.status >= 500) {
        // Server error → transient, retry.
        lastError = apiError;
        continue;
      }
      // 4xx → deterministic client error, do not retry.
      throw apiError;
    }

    throw lastError ?? new PaystackError("Paystack request failed", { status: 0 });
  }

  post<T = unknown>(path: string, body: unknown): Promise<PaystackEnvelope<T>> {
    return this.request<T>("POST", path, body);
  }

  get<T = unknown>(path: string): Promise<PaystackEnvelope<T>> {
    return this.request<T>("GET", path);
  }

  private async fetchWithTimeout(url: string, method: string, body?: unknown): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private parseBody<T>(text: string): PaystackEnvelope<T> | undefined {
    if (!text) return undefined;
    try {
      return JSON.parse(text) as PaystackEnvelope<T>;
    } catch {
      return undefined;
    }
  }

  private apiError(
    status: number,
    env: PaystackEnvelope | undefined,
    statusText: string
  ): PaystackError {
    const message = env?.message || statusText || "Paystack request failed";
    return new PaystackError(this.redact(message), { status, raw: env });
  }

  private networkError(err: unknown): PaystackError {
    const base = err instanceof Error && err.message ? err.message : "network error";
    // raw is intentionally omitted: the underlying error object may reference the key.
    return new PaystackError(this.redact(base), { status: 0 });
  }

  /** Defense-in-depth: strip any accidental secret-key occurrence from a string. */
  private redact(text: string): string {
    if (!this.secretKey) return text;
    return text.split(this.secretKey).join("[redacted]");
  }
}
