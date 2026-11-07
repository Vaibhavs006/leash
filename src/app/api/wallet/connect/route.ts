import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { createPayPalSetupToken } from "@/lib/paypal/api";
import { appUrl } from "@/lib/server/env";
import { handle, json } from "@/lib/server/http";
import { paypal } from "@/lib/server/paypal";
import { currentWorkspace } from "@/lib/server/session";

/** Start "save PayPal for agent purchases": returns PayPal's approval URL. */
export async function POST() {
  return handle(async () => {
    const ws = await currentWorkspace();
    const st = await createPayPalSetupToken(paypal(), {
      returnUrl: `${appUrl()}/api/wallet/return`,
      cancelUrl: `${appUrl()}/?wallet=cancelled`,
      brandName: "Leash",
      customerId: ws.paypalCustomerId ?? undefined,
    });
    await db.update(workspaces).set({ pendingSetupTokenId: st.id, paypalCustomerId: st.customerId ?? ws.paypalCustomerId }).where(eq(workspaces.id, ws.id));
    return json({ approveUrl: st.approveUrl });
  });
}
