import { connection } from "next/server";
import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { runEvents, runs } from "@/db/schema";
import { handle, json } from "@/lib/server/http";
import { currentWorkspace } from "@/lib/server/session";


/** Poll with ?after=<lastEventId> to get only new events. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection(); // request-time only; never prerender
  return handle(async () => {
    const ws = await currentWorkspace();
    const { id } = await ctx.params;
    const after = Number(new URL(req.url).searchParams.get("after") ?? 0) || 0;
    const [run] = await db.select().from(runs).where(and(eq(runs.id, id), eq(runs.workspaceId, ws.id)));
    if (!run) throw new Error("Run not found");
    const events = await db
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, id), gt(runEvents.id, after)))
      .orderBy(asc(runEvents.id));
    return json({ run, events });
  });
}
