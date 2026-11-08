import { connection } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { integrations } from "@/lib/server/env";
import { modes } from "@/lib/server/modes";
import { json } from "@/lib/server/http";


/** Confirms which commit is live and what is configured. Safe to expose: booleans only. */
export async function GET() {
  await connection(); // request-time only; never prerender
  let database = false;
  try {
    await db.execute(sql`select 1`);
    database = true;
  } catch {}
  return json({ ok: database, commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? "local", database, integrations: integrations(), modes: modes() }, database ? 200 : 503);
}
