import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { purchases } from "@/db/schema";
import { createSimulatedGateway } from "@/lib/demo/gateway";
import { paypalGateway } from "@/lib/purchases/gateway";
import type { PaymentGateway, ServiceDeps } from "@/lib/purchases/service";
import { appUrl, requireConfig } from "./env";
import { requireMode } from "./modes";

const simulatedGateway = () =>
  createSimulatedGateway({
    appUrl: appUrl(),
    totalCents: async (id) => (await db.select({ t: purchases.totalCents }).from(purchases).where(eq(purchases.id, id)))[0]?.t ?? 0,
  });

/**
 * Gateway for an existing purchase: whichever one created it. A simulated purchase
 * never reaches PayPal, and a live one never touches the simulator.
 */
export function gatewayFor(simulated: boolean): PaymentGateway {
  if (simulated) return simulatedGateway();
  requireConfig("paypal");
  return paypalGateway;
}

/** Gateway for NEW payments, based on current configuration. */
export function currentPayments(): { gateway: PaymentGateway; simulated: boolean } {
  const simulated = requireMode("payments") === "simulated";
  return { gateway: gatewayFor(simulated), simulated };
}

export async function depsForPurchase(purchaseId: string): Promise<ServiceDeps> {
  const [p] = await db.select({ simulated: purchases.simulated }).from(purchases).where(eq(purchases.id, purchaseId));
  // Unknown id: the service will 404 before any gateway call; avoid a misleading 503.
  return { db, gateway: gatewayFor(p?.simulated ?? true), appUrl: appUrl() };
}
