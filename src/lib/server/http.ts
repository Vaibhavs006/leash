import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { MissingConfigError } from "./env";
import { RunLimitError } from "./runner";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Uniform error mapping: specific, user-safe messages; details stay in server logs. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof MissingConfigError) return json({ error: e.message, missing: e.keys, integration: e.integration }, 503);
    if (e instanceof RunLimitError) return json({ error: e.message }, 429);
    if (e instanceof ZodError) return json({ error: "Invalid input", issues: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
    const message = e instanceof Error ? e.message : String(e);
    console.error("[api]", message, e);
    return json({ error: message.slice(0, 400) }, /not found/i.test(message) ? 404 : 400);
  }
}
