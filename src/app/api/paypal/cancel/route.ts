import { connection, NextResponse } from "next/server";
import { db } from "@/db";
import { paypalGateway } from "@/lib/purchases/gateway";
import { cancelBuyerApproval } from "@/lib/purchases/service";
import { appUrl } from "@/lib/server/env";

/** Buyer cancelled on PayPal: put the purchase back in the approval queue. */
export async function GET(req: Request) {
  await connection(); // request-time only; never prerender
  const purchaseId = new URL(req.url).searchParams.get("purchase") ?? "";
  try {
    await cancelBuyerApproval({ db, gateway: paypalGateway, appUrl: appUrl() }, purchaseId);
  } catch {}
  const back = new URL("/", appUrl());
  back.searchParams.set("purchase", purchaseId);
  back.searchParams.set("cancelled", "1");
  return NextResponse.redirect(back);
}
