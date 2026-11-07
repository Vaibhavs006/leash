import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { mandates } from "@/db/schema";
import { handle, json } from "@/lib/server/http";
import { currentWorkspace } from "@/lib/server/session";
import { MandateInput } from "../schema";

const Patch = z.union([z.object({ status: z.enum(["active", "paused", "revoked"]) }), MandateInput]);

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const ws = await currentWorkspace();
    const { id } = await ctx.params;
    const body = Patch.parse(await req.json());
    const values =
      "status" in body
        ? { status: body.status }
        : (({ expiresInDays, ...rest }) => ({ ...rest, expiresAt: new Date(Date.now() + expiresInDays * 86400_000) }))(body);
    const [row] = await db
      .update(mandates)
      .set(values)
      .where(and(eq(mandates.id, id), eq(mandates.workspaceId, ws.id)))
      .returning();
    if (!row) throw new Error("Mandate not found");
    return json(row);
  });
}
