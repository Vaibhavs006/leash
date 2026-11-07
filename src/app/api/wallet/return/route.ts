import { eq } from "drizzle-orm";
import { connection, NextResponse } from "next/server";
import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { createPaymentTokenFromSetupToken } from "@/lib/paypal/api";
import { appUrl } from "@/lib/server/env";
import { paypal } from "@/lib/server/paypal";
import { currentWorkspace } from "@/lib/server/session";

/**
 * PayPal returns here after the payer approves vaulting. We only ever use the setup
 * token stored on THIS workspace — query parameters are not trusted.
 */
export async function GET() {
  await connection(); // request-time only; never prerender
  const back = new URL("/", appUrl());
  try {
    const ws = await currentWorkspace();
    if (!ws.pendingSetupTokenId) throw new Error("No wallet connection in progress");
    const pt = await createPaymentTokenFromSetupToken(paypal(), ws.pendingSetupTokenId);
    await db
      .update(workspaces)
      .set({ vaultId: pt.vaultId, paypalCustomerId: pt.customerId ?? ws.paypalCustomerId, payerEmail: pt.payerEmail ?? null, pendingSetupTokenId: null })
      .where(eq(workspaces.id, ws.id));
    back.searchParams.set("wallet", "connected");
  } catch (e) {
    back.searchParams.set("wallet", "error");
    back.searchParams.set("error", (e instanceof Error ? e.message : String(e)).slice(0, 200));
  }
  return NextResponse.redirect(back);
}
