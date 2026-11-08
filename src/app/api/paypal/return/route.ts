import { and, eq } from "drizzle-orm";
import { connection, NextResponse } from "next/server";
import { db } from "@/db";
import { purchases } from "@/db/schema";
import { completeBuyerApproval } from "@/lib/purchases/service";
import { appUrl } from "@/lib/server/env";
import { depsForPurchase } from "@/lib/server/payments";
import { currentWorkspace } from "@/lib/server/session";

/** PayPal (or the offline simulator) redirects the buyer here after approving a step-up purchase. */
export async function GET(req: Request) {
  await connection(); // request-time only; never prerender
  const url = new URL(req.url);
  const purchaseId = url.searchParams.get("purchase") ?? "";
  const orderId = url.searchParams.get("token") ?? "";
  const back = new URL("/", appUrl());
  back.searchParams.set("purchase", purchaseId);
  try {
    const ws = await currentWorkspace();
    const [own] = await db.select({ id: purchases.id }).from(purchases).where(and(eq(purchases.id, purchaseId), eq(purchases.workspaceId, ws.id)));
    if (!own) throw new Error("Purchase not found");
    const p = await completeBuyerApproval(await depsForPurchase(purchaseId), purchaseId, orderId);
    back.searchParams.set("paid", p.status === "captured" ? "1" : "0");
    if (p.simulated) back.searchParams.set("sim", "1");
    if (p.status !== "captured" && p.error) back.searchParams.set("error", p.error.slice(0, 200));
  } catch (e) {
    back.searchParams.set("paid", "0");
    back.searchParams.set("error", (e instanceof Error ? e.message : String(e)).slice(0, 200));
  }
  return NextResponse.redirect(back);
}
