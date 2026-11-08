import { eq } from "drizzle-orm";
import { db } from "@/db";
import { workspaces } from "@/db/schema";
import { deletePaymentToken } from "@/lib/paypal/api";
import { configured } from "@/lib/server/env";
import { handle, json } from "@/lib/server/http";
import { paypal } from "@/lib/server/paypal";
import { currentWorkspace } from "@/lib/server/session";

/** Revoke the saved wallet (at PayPal, if it is a real one) and forget it locally. */
export async function POST() {
  return handle(async () => {
    const ws = await currentWorkspace();
    if (ws.vaultId && !ws.walletSimulated && configured("paypal")) {
      try {
        await deletePaymentToken(paypal(), ws.vaultId);
      } catch (e) {
        console.error("[wallet] delete token failed", e);
      }
    }
    await db.update(workspaces).set({ vaultId: null, walletSimulated: false, payerEmail: null, pendingSetupTokenId: null }).where(eq(workspaces.id, ws.id));
    return json({ ok: true });
  });
}
