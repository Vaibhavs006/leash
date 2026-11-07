import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mandates, purchases, runs } from "@/db/schema";
import { handle, json } from "@/lib/server/http";
import { currentWorkspace, defaultMandate } from "@/lib/server/session";

/** Clear this visitor's mandates, runs and ledger (sandbox data only). The saved wallet and run quota are kept. */
export async function POST() {
  return handle(async () => {
    const ws = await currentWorkspace();
    await db.transaction(async (tx) => {
      await tx.delete(purchases).where(eq(purchases.workspaceId, ws.id));
      await tx.delete(runs).where(eq(runs.workspaceId, ws.id));
      await tx.delete(mandates).where(eq(mandates.workspaceId, ws.id));
      await tx.insert(mandates).values(defaultMandate(ws.id));
    });
    return json({ ok: true });
  });
}
