import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { mandates } from "@/db/schema";
import { handle, json } from "@/lib/server/http";
import { currentWorkspace } from "@/lib/server/session";
import { MandateInput } from "./schema";

const MAX_MANDATES = 5;

export async function POST(req: Request) {
  return handle(async () => {
    const ws = await currentWorkspace();
    const { expiresInDays, ...m } = MandateInput.parse(await req.json());
    const [{ n }] = await db.select({ n: count() }).from(mandates).where(eq(mandates.workspaceId, ws.id));
    if (n >= MAX_MANDATES) throw new Error(`At most ${MAX_MANDATES} mandates per workspace`);
    const [row] = await db
      .insert(mandates)
      .values({ ...m, workspaceId: ws.id, expiresAt: new Date(Date.now() + expiresInDays * 86400_000) })
      .returning();
    return json(row, 201);
  });
}
