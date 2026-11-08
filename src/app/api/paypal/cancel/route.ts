import { and, eq } from "drizzle-orm";
import { connection, NextResponse } from "next/server";
import { db } from "@/db";
import { purchases } from "@/db/schema";
import { cancelBuyerApproval } from "@/lib/purchases/service";
import { appUrl } from "@/lib/server/env";
import { depsForPurchase } from "@/lib/server/payments";
import { currentWorkspace } from "@/lib/server/session";

/** Buyer cancelled the approval: put the purchase back in the approval queue. */
export async function GET(req: Request) {
  await connection(); // request-time only; never prerender
  const purchaseId = new URL(req.url).searchParams.get("purchase") ?? "";
  try {
    const ws = await currentWorkspace();
    const [own] = await db.select({ id: purchases.id }).from(purchases).where(and(eq(purchases.id, purchaseId), eq(purchases.workspaceId, ws.id)));
    if (own) await cancelBuyerApproval(await depsForPurchase(purchaseId), purchaseId);
  } catch (e) {
    console.error("[paypal/cancel]", e);
  }
  const back = new URL("/", appUrl());
  back.searchParams.set("purchase", purchaseId);
  back.searchParams.set("cancelled", "1");
  return NextResponse.redirect(back);
}
