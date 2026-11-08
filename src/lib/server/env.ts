import "server-only";

/**
 * Environment access. Only DATABASE_URL is needed to boot; each integration is
 * checked when used, so the UI can show exactly which key is missing instead of crashing.
 */
export type Integration = "paypal" | "anthropic" | "channel3" | "webhooks";

const KEYS: Record<Integration, string[]> = {
  paypal: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"],
  anthropic: ["ANTHROPIC_API_KEY"],
  channel3: ["CHANNEL3_API_KEY"],
  webhooks: ["PAYPAL_WEBHOOK_ID"],
};

export class MissingConfigError extends Error {
  constructor(public readonly integration: Integration, public readonly keys: string[]) {
    super(`${integration} is not configured: set ${keys.join(", ")}`);
    this.name = "MissingConfigError";
  }
}

export function configured(i: Integration): boolean {
  return KEYS[i].every((k) => !!process.env[k]?.trim());
}

export function requireConfig(i: Integration): void {
  const missing = KEYS[i].filter((k) => !process.env[k]?.trim());
  if (missing.length) throw new MissingConfigError(i, missing);
}

export function integrations(): Record<Integration, boolean> {
  return { paypal: configured("paypal"), anthropic: configured("anthropic"), channel3: configured("channel3"), webhooks: configured("webhooks") };
}

export function appUrl(): string {
  const explicit = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL;
  return (explicit || "http://localhost:3000").replace(/\/$/, "");
}

export function anthropicModelId(): string {
  return process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
}

export function maxRunsPerWorkspace(): number {
  const n = Number(process.env.MAX_RUNS_PER_WORKSPACE);
  return Number.isInteger(n) && n > 0 ? n : 15;
}
