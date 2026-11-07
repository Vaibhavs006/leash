import "server-only";
import { z } from "zod";

const Env = z.object({
  PAYPAL_CLIENT_ID: z.string().min(1),
  PAYPAL_CLIENT_SECRET: z.string().min(1),
  PAYPAL_WEBHOOK_ID: z.string().optional().default(""),
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.string().optional().transform((v) => v || "claude-sonnet-5-5"),
  CHANNEL3_API_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().transform((u) => u.replace(/\/$/, "")),
  MAX_RUNS_PER_WORKSPACE: z.coerce.number().int().positive().default(15),
});

export type ServerEnv = z.infer<typeof Env>;

let cached: ServerEnv | null = null;

/** Validated lazily so `next build` works without secrets present. */
export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid server environment: ${missing}. See .env.example`);
  }
  cached = parsed.data;
  return cached;
}
