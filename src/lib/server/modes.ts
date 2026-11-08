import "server-only";
import { configured, MissingConfigError, type Integration } from "./env";

/**
 * Each integration runs "live" when its keys are set. Otherwise, with DEMO_MODE
 * unset or "auto", it falls back to a clearly-labelled offline simulator; with
 * DEMO_MODE=off it is "unavailable" and the feature returns a 503.
 */
export type Mode = "live" | "simulated" | "unavailable";

export interface Modes {
  catalog: Mode; // Channel3
  agent: Mode; // Claude
  payments: Mode; // PayPal
}

const SOURCE: Record<keyof Modes, Integration> = { catalog: "channel3", agent: "anthropic", payments: "paypal" };

export function demoAllowed(): boolean {
  return (process.env.DEMO_MODE ?? "auto").toLowerCase() !== "off";
}

export function modes(): Modes {
  const pick = (k: keyof Modes): Mode => (configured(SOURCE[k]) ? "live" : demoAllowed() ? "simulated" : "unavailable");
  return { catalog: pick("catalog"), agent: pick("agent"), payments: pick("payments") };
}

/** Returns the mode, throwing a MissingConfigError (-> 503) when unavailable. */
export function requireMode(k: keyof Modes): "live" | "simulated" {
  const m = modes()[k];
  if (m === "unavailable") {
    const keys = { catalog: ["CHANNEL3_API_KEY"], agent: ["ANTHROPIC_API_KEY"], payments: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"] }[k];
    throw new MissingConfigError(SOURCE[k], keys);
  }
  return m;
}
