import { db } from "@/db";
import { paypalGateway } from "@/lib/purchases/gateway";
import { approvePurchase, refundPurchase, rejectPurchase } from "@/lib/purchases/service";
import { appUrl, requireConfig } from "@/lib/server/env";
import { handle, json } from "@/lib/server/http";
import { currentWorkspace } from "@/lib/server/session";

const deps = () => ({ db, gateway: paypalGateway, appUrl: appUrl() });

export async function POST(_req: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  return handle(async () => {
    const ws = await currentWorkspace();
    const { id, action } = await ctx.params;
    switch (action) {
      case "approve": {
        requireConfig("paypal");
        const r = await approvePurchase(deps(), ws.id, id);
        return json({ purchase: r.purchase, approveUrl: r.approveUrl ?? null });
      }
      case "reject":
        return json({ purchase: await rejectPurchase(deps(), ws.id, id) });
      case "refund":
        requireConfig("paypal");
        return json({ purchase: await refundPurchase(deps(), ws.id, id) });
      default:
        return json({ error: "Unknown action" }, 404);
    }
  });
}
