import { approvePurchase, refundPurchase, rejectPurchase } from "@/lib/purchases/service";
import { handle, json } from "@/lib/server/http";
import { depsForPurchase } from "@/lib/server/payments";
import { currentWorkspace } from "@/lib/server/session";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string; action: string }> }) {
  return handle(async () => {
    const ws = await currentWorkspace();
    const { id, action } = await ctx.params;
    // Uses the gateway that created this purchase (live PayPal or the offline simulator).
    const deps = await depsForPurchase(id);
    switch (action) {
      case "approve": {
        const r = await approvePurchase(deps, ws.id, id);
        return json({ purchase: r.purchase, approveUrl: r.approveUrl ?? null });
      }
      case "reject":
        return json({ purchase: await rejectPurchase(deps, ws.id, id) });
      case "refund":
        return json({ purchase: await refundPurchase(deps, ws.id, id) });
      default:
        return json({ error: "Unknown action" }, 404);
    }
  });
}
