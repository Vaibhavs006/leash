import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { mandates, purchases, runs, type Workspace } from "@/db/schema";
import { mandateSpend } from "@/lib/purchases/service";
import { integrations } from "./env";

/** Everything the dashboard renders, scoped to one workspace. Never exposes vault ids. */
export async function workspaceState(ws: Workspace) {
  const ms = await db.select().from(mandates).where(eq(mandates.workspaceId, ws.id)).orderBy(desc(mandates.createdAt));
  const withSpend = await Promise.all(ms.map(async (m) => ({ ...m, ...(await mandateSpend(db, m.id)) })));
  const ps = await db.select().from(purchases).where(eq(purchases.workspaceId, ws.id)).orderBy(desc(purchases.createdAt)).limit(100);
  const rs = await db.select().from(runs).where(eq(runs.workspaceId, ws.id)).orderBy(desc(runs.createdAt)).limit(20);
  return {
    workspace: {
      id: ws.id,
      businessName: ws.businessName,
      walletConnected: !!ws.vaultId,
      payerEmail: ws.payerEmail,
      runsUsed: ws.runsUsed,
    },
    integrations: integrations(),
    mandates: withSpend,
    purchases: ps.map((p) => ({ ...p, idempotencyKey: undefined })),
    runs: rs,
  };
}

export type WorkspaceState = Awaited<ReturnType<typeof workspaceState>>;
