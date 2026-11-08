import { eq } from "drizzle-orm";
import { connection, NextResponse } from "next/server";
import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { isSimulatedId, newSimulatedVaultId, SIM_PAYER_EMAIL } from "@/lib/demo/gateway";
import { createPaymentTokenFromSetupToken } from "@/lib/paypal/api";
import { appUrl } from "@/lib/server/env";
import { publicError } from "@/lib/server/http";
import { modes } from "@/lib/server/modes";
import { paypal } from "@/lib/server/paypal";
import { currentWorkspace } from "@/lib/server/session";

/**
 * Returns here after the payer approves saving a wallet. Only the setup token stored on
 * THIS workspace is used; query parameters are not trusted.
 */
export async function GET() {
  await connection(); // request-time only; never prerender
  const back = new URL("/", appUrl());
  try {
    const ws = await currentWorkspace();
    const pending = ws.pendingSetupTokenId;
    if (!pending) throw new Error("No wallet connection in progress");
    if (isSimulatedId(pending)) {
      if (modes().payments !== "simulated") throw new Error("Simulated wallet setup is disabled while live PayPal is configured");
      await db
        .update(workspaces)
        .set({ vaultId: newSimulatedVaultId(), walletSimulated: true, payerEmail: SIM_PAYER_EMAIL, pendingSetupTokenId: null })
        .where(eq(workspaces.id, ws.id));
      back.searchParams.set("sim", "1");
    } else {
      const pt = await createPaymentTokenFromSetupToken(paypal(), pending);
      await db
        .update(workspaces)
        .set({ vaultId: pt.vaultId, walletSimulated: false, paypalCustomerId: pt.customerId ?? ws.paypalCustomerId, payerEmail: pt.payerEmail ?? null, pendingSetupTokenId: null })
        .where(eq(workspaces.id, ws.id));
    }
    back.searchParams.set("wallet", "connected");
  } catch (e) {
    back.searchParams.set("wallet", "error");
    back.searchParams.set("error", publicError(e).message.slice(0, 200));
  }
  return NextResponse.redirect(back);
}
