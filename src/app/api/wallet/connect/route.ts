import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { simulatedSetupToken } from "@/lib/demo/gateway";
import { createPayPalSetupToken } from "@/lib/paypal/api";
import { appUrl } from "@/lib/server/env";
import { handle, json } from "@/lib/server/http";
import { requireMode } from "@/lib/server/modes";
import { paypal } from "@/lib/server/paypal";
import { currentWorkspace } from "@/lib/server/session";

/** Start "save a wallet for agent purchases": returns the approval URL (PayPal, or the offline simulator). */
export async function POST() {
  return handle(async () => {
    const ws = await currentWorkspace();
    if (requireMode("payments") === "simulated") {
      const st = simulatedSetupToken(appUrl());
      await db.update(workspaces).set({ pendingSetupTokenId: st.id }).where(eq(workspaces.id, ws.id));
      return json({ approveUrl: st.approveUrl, simulated: true });
    }
    const st = await createPayPalSetupToken(paypal(), {
      returnUrl: `${appUrl()}/api/wallet/return`,
      cancelUrl: `${appUrl()}/?wallet=cancelled`,
      brandName: "Leash",
      customerId: ws.paypalCustomerId ?? undefined,
    });
    await db.update(workspaces).set({ pendingSetupTokenId: st.id, paypalCustomerId: st.customerId ?? ws.paypalCustomerId }).where(eq(workspaces.id, ws.id));
    return json({ approveUrl: st.approveUrl, simulated: false });
  });
}
