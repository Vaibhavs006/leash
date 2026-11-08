import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { MissingConfigError } from "./env";
import { RunLimitError } from "./runner";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

type ErrLike = { name?: string; message?: string; code?: unknown; cause?: unknown };

function isConnectionError(e: ErrLike): boolean {
  const codes = [e.code, (e.cause as ErrLike | undefined)?.code];
  return codes.some((c) => typeof c === "string" && /^(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|CONNECT_TIMEOUT|57P0[1-3])$/.test(c));
}

/** Errors whose text may expose internals (SQL, hosts, stack-ish details). */
function isInternal(e: ErrLike): boolean {
  return (
    e.name === "DrizzleQueryError" ||
    e.name === "PostgresError" ||
    /^Failed query:/.test(e.message ?? "") ||
    isConnectionError(e) ||
    e instanceof TypeError ||
    e instanceof ReferenceError ||
    e instanceof SyntaxError
  );
}

/** A message that is safe to show users; internal details go to the server log with a reference. */
export function publicError(e: unknown): { message: string; status: number } {
  const err = (e ?? {}) as ErrLike;
  if (isInternal(err)) {
    const ref = randomUUID().slice(0, 8);
    console.error(`[api] ref=${ref}`, e);
    return isConnectionError(err) || isConnectionError((err.cause ?? {}) as ErrLike)
      ? { message: `Database temporarily unavailable (ref ${ref}). Please retry shortly.`, status: 503 }
      : { message: `Internal error (ref ${ref}).`, status: 500 };
  }
  const message = e instanceof Error ? e.message : String(e);
  console.error("[api]", message);
  return { message: message.slice(0, 400), status: /not found/i.test(message) ? 404 : 400 };
}

/** Uniform error mapping: specific, user-safe messages; details stay in server logs. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof MissingConfigError) return json({ error: e.message, missing: e.keys, integration: e.integration }, 503);
    if (e instanceof RunLimitError) return json({ error: e.message }, 429);
    if (e instanceof ZodError) return json({ error: "Invalid input", issues: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, 400);
    const { message, status } = publicError(e);
    return json({ error: message }, status);
  }
}
