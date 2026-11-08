import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { mandates, purchases, runs, type Workspace } from "@/db/schema";
import { mandateSpend } from "@/lib/purchases/service";
import { integrations } from "./env";
import { modes } from "./modes";

/** Everything the dashboard renders, scoped to one workspace. Never exposes vault ids. */
export async function workspaceState(ws: Workspace) {
  const ms = await db.select().from(mandates).where(eq(mandates.workspaceId, ws.id)).orderBy(desc(mandates.createdAt));
  const withSpend = await Promise.all(ms.map(async (m) => ({ ...m, ...(await mandateSpend(db, m.id)) })));
  const ps = await db.select().from(purchases).where(eq(purchases.workspaceId, ws.id)).orderBy(desc(purchases.createdAt)).limit(100);
  const rs = await db.select().from(runs).where(eq(runs.workspaceId, ws.id)).orderBy(desc(runs.createdAt)).limit(20);
  const m = modes();
  return {
    workspace: {
      id: ws.id,
      businessName: ws.businessName,
      // Usable for NEW payments: a simulated wallet only works while payments are simulated, and vice versa.
      walletConnected: !!ws.vaultId && ws.walletSimulated === (m.payments === "simulated"),
      walletSimulated: ws.walletSimulated,
      payerEmail: ws.payerEmail,
      runsUsed: ws.runsUsed,
    },
    integrations: integrations(),
    modes: m,
    mandates: withSpend,
    purchases: ps.map((p) => ({ ...p, idempotencyKey: undefined })),
    runs: rs,
  };
}

export type WorkspaceState = Awaited<ReturnType<typeof workspaceState>>;
