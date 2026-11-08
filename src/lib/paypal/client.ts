/**
 * Minimal, typed PayPal REST client.
 *
 * Deliberately thin: OAuth token caching, idempotency headers and structured
 * errors. Payment credentials live only here (server side) — the AI agent
 * never sees or calls these functions directly.
 */
import { randomUUID } from "node:crypto";

export type PayPalEnv = "sandbox" | "live";

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  env: PayPalEnv;
}

export class PayPalError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly debugId: string | undefined,
    public readonly details: unknown,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

export function apiBase(env: PayPalEnv): string {
  return env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

export class PayPalClient {
  private token: CachedToken | null = null;
  private tokenPromise: Promise<string> | null = null;

  constructor(private readonly config: PayPalConfig) {}

  get env(): PayPalEnv {
    return this.config.env;
  }

  private async fetchToken(): Promise<string> {
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const res = await fetch(`${apiBase(this.config.env)}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new PayPalError(
        `PayPal OAuth failed (${res.status}): ${String(body.error_description ?? body.error ?? "unknown")}`,
        res.status,
        res.headers.get("paypal-debug-id") ?? undefined,
        body,
      );
    }
    const expiresIn = Number(body.expires_in ?? 0);
    this.token = {
      value: String(body.access_token),
      // Refresh 5 minutes early so in-flight requests never use an expired token.
      expiresAt: Date.now() + Math.max(0, expiresIn - 300) * 1000,
    };
    return this.token.value;
  }

  async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    // Collapse concurrent refreshes into one request.
    this.tokenPromise ??= this.fetchToken().finally(() => {
      this.tokenPromise = null;
    });
    return this.tokenPromise;
  }

  /**
   * Make an authenticated request. `requestId` makes POSTs idempotent: PayPal
   * returns the original result if the same id is retried.
   */
  async request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    opts: { body?: unknown; requestId?: string; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const doRequest = async (): Promise<Response> => {
      const token = await this.accessToken();
      return fetch(`${apiBase(this.config.env)}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
          ...(method === "POST" ? { "PayPal-Request-Id": opts.requestId ?? randomUUID() } : {}),
          ...opts.headers,
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        cache: "no-store",
      });
    };

    let res = await doRequest();
    if (res.status === 401) {
      // Token revoked/expired early — refresh once and retry.
      this.token = null;
      res = await doRequest();
    }

    const text = await res.text();
    let body: unknown;
    try {
      body = text ? (JSON.parse(text) as unknown) : undefined;
    } catch {
      // PayPal edge/HTML error pages are not JSON; keep a snippet for diagnosis.
      body = { message: text.slice(0, 300) };
      if (res.ok) throw new PayPalError(`PayPal ${method} ${path} returned non-JSON`, res.status, res.headers.get("paypal-debug-id") ?? undefined, body);
    }
    if (!res.ok) {
      const b = (body ?? {}) as Record<string, unknown>;
      const issue = Array.isArray(b.details)
        ? (b.details as Array<Record<string, unknown>>).map((d) => d.issue ?? d.description).join(", ")
        : "";
      throw new PayPalError(
        `PayPal ${method} ${path} failed (${res.status}): ${String(b.name ?? "")} ${String(b.message ?? "")} ${issue}`.trim(),
        res.status,
        res.headers.get("paypal-debug-id") ?? (b.debug_id as string | undefined),
        body,
      );
    }
    return body as T;
  }
}

export interface PayPalLink {
  href: string;
  rel: string;
  method?: string;
}

export function findLink(links: PayPalLink[] | undefined, ...rels: string[]): string | undefined {
  return links?.find((l) => rels.includes(l.rel))?.href;
}
