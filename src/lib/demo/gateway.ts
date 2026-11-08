/**
 * SIMULATED payment gateway, used only when PayPal credentials are not configured.
 *
 * Implements the same PaymentGateway interface as the real PayPal adapter, so the
 * purchase lifecycle (charge, approval, capture, refund, budget accounting) is
 * exercised end to end. No network calls, no money. Every id starts with "SIM-"
 * and the buyer-approval step goes to Leash's own clearly-labelled simulator page
 * (/demo/approve), never to anything resembling PayPal.
 */
import { randomBytes } from "node:crypto";
import type { PaymentGateway } from "@/lib/purchases/service";

const id = (prefix: string) => `SIM-${prefix}-${randomBytes(5).toString("hex").toUpperCase()}`;

export const SIM_PREFIX = "SIM-";
export const isSimulatedId = (v: string | null | undefined) => !!v && v.startsWith(SIM_PREFIX);

export function createSimulatedGateway(opts: {
  appUrl: string;
  /** Looks up the purchase total so refunds return the full captured amount. */
  totalCents: (purchaseId: string) => Promise<number>;
}): PaymentGateway {
  return {
    async chargeVault({ vaultId }) {
      if (!isSimulatedId(vaultId)) throw new Error("Simulated gateway refused a non-simulated vault token");
      return { orderId: id("ORDER"), captureId: id("CAPTURE"), status: "COMPLETED", captureStatus: "COMPLETED" };
    },
    async createApprovalOrder({ purchaseId }) {
      const orderId = id("ORDER");
      const u = new URL("/demo/approve", opts.appUrl);
      u.searchParams.set("kind", "order");
      u.searchParams.set("purchase", purchaseId);
      u.searchParams.set("token", orderId);
      return { orderId, approveUrl: u.toString() };
    },
    async captureOrder(orderId) {
      if (!isSimulatedId(orderId)) throw new Error("Simulated gateway refused a non-simulated order");
      return { orderId, captureId: id("CAPTURE"), status: "COMPLETED", captureStatus: "COMPLETED" };
    },
    async refund(captureId, purchaseId) {
      if (!isSimulatedId(captureId)) throw new Error("Simulated gateway refused a non-simulated capture");
      return { refundId: id("REFUND"), status: "COMPLETED", amountCents: await opts.totalCents(purchaseId) };
    },
  };
}

export function simulatedSetupToken(appUrl: string): { id: string; approveUrl: string } {
  const setupId = id("SETUP");
  const u = new URL("/demo/approve", appUrl);
  u.searchParams.set("kind", "wallet");
  return { id: setupId, approveUrl: u.toString() };
}

export const SIM_PAYER_EMAIL = "demo-buyer@leash.example";
export const newSimulatedVaultId = () => id("VAULT");
