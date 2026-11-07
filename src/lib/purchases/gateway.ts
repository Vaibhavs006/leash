import "server-only";
import { captureOrder, chargeVaultedWallet, createApprovalOrder, refundCapture, type LineItem } from "@/lib/paypal/api";
import type { PurchaseItem } from "@/db/schema";
import { paypal } from "@/lib/server/paypal";
import type { PaymentGateway } from "./service";

const lineItems = (items: PurchaseItem[]): LineItem[] =>
  items.map((i) => ({ name: i.title, unitCents: i.unitCents, quantity: i.quantity, sku: i.productId }));

/** Real PayPal sandbox gateway. Idempotency keys derive from the purchase id. */
export const paypalGateway: PaymentGateway = {
  async chargeVault({ vaultId, items, purchaseId, description }) {
    const r = await chargeVaultedWallet(paypal(), {
      vaultId,
      items: lineItems(items),
      referenceId: purchaseId,
      description,
      idempotencyKey: `mit-${purchaseId}`,
    });
    return { orderId: r.orderId, captureId: r.captureId, status: r.status, captureStatus: r.captureStatus };
  },
  async createApprovalOrder({ items, purchaseId, description, returnUrl, cancelUrl }) {
    const r = await createApprovalOrder(paypal(), {
      items: lineItems(items),
      referenceId: purchaseId,
      description,
      // New key per attempt: a cancelled approval can be retried with a fresh order.
      idempotencyKey: `cit-${purchaseId}-${Date.now()}`,
      returnUrl,
      cancelUrl,
    });
    return { orderId: r.orderId, approveUrl: r.approveUrl };
  },
  async captureOrder(orderId) {
    const r = await captureOrder(paypal(), orderId);
    return { orderId: r.orderId, captureId: r.captureId, status: r.status, captureStatus: r.captureStatus };
  },
  async refund(captureId, purchaseId) {
    return refundCapture(paypal(), captureId, { idempotencyKey: `ref-${purchaseId}`, note: "Refunded via Leash" });
  },
};
