import { and, eq } from "drizzle-orm";
import { connection, NextResponse } from "next/server";
import { db } from "@/db";
import { purchases } from "@/db/schema";
import { paypalGateway } from "@/lib/purchases/gateway";
import { completeBuyerApproval } from "@/lib/purchases/service";
import { appUrl } from "@/lib/server/env";
import { currentWorkspace } from "@/lib/server/session";

/** PayPal redirects the buyer here after approving a step-up purchase. */
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
    const p = await completeBuyerApproval({ db, gateway: paypalGateway, appUrl: appUrl() }, purchaseId, orderId);
    back.searchParams.set("paid", p.status === "captured" ? "1" : "0");
  } catch (e) {
    back.searchParams.set("paid", "0");
    back.searchParams.set("error", (e instanceof Error ? e.message : String(e)).slice(0, 200));
  }
  return NextResponse.redirect(back);
}
