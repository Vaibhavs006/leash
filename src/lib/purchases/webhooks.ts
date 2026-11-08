/**
 * PayPal webhook reconciliation. Synchronous API responses are the primary source
 * of truth; webhooks catch what happens later (pending captures settling, refunds
 * or reversals done outside Leash, vault tokens revoked by the payer).
 */
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { purchases, webhookEvents, workspaces } from "@/db/schema";
import { valueToCents } from "@/lib/paypal/api";

type DB = PostgresJsDatabase<typeof schema>;

export interface PayPalWebhookEvent {
  id: string;
  event_type: string;
  resource?: {
    id?: string;
    status?: string;
    amount?: { value?: string };
    supplementary_data?: { related_ids?: { order_id?: string } };
    links?: Array<{ href: string; rel: string }>;
  };
}

export type WebhookOutcome = "duplicate" | "ignored" | "updated" | "no_match";

function captureIdFromRefund(ev: PayPalWebhookEvent): string | undefined {
  const up = ev.resource?.links?.find((l) => l.rel === "up")?.href;
  return up?.match(/\/captures\/([^/?]+)/)?.[1];
}

export async function handleWebhookEvent(db: DB, ev: PayPalWebhookEvent, verified: boolean): Promise<WebhookOutcome> {
  // Unverified events are never stored or acted on: anyone can POST to a public URL.
  if (!verified) return "ignored";
  // Record + apply atomically: if applying fails, the event isn't marked seen, so PayPal's retry is processed.
  return db.transaction((tx) => apply(tx as unknown as DB, ev));
}

async function apply(db: DB, ev: PayPalWebhookEvent): Promise<WebhookOutcome> {
  const inserted = await db
    .insert(webhookEvents)
    .values({ id: ev.id, eventType: ev.event_type, resourceId: ev.resource?.id ?? null, verified: true, payload: ev })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  if (!inserted.length) return "duplicate";

  const r = ev.resource ?? {};
  const now = new Date();

  switch (ev.event_type) {
    case "PAYMENT.CAPTURE.COMPLETED": {
      const orderId = r.supplementary_data?.related_ids?.order_id;
      if (!r.id) return "no_match";
      const rows = await db
        .update(purchases)
        .set({ status: "captured", paypalCaptureId: r.id, error: null, updatedAt: now })
        .where(
          and(
            or(eq(purchases.paypalCaptureId, r.id), orderId ? eq(purchases.paypalOrderId, orderId) : sql`false`),
            inArray(purchases.status, ["processing", "awaiting_payer", "failed"]),
          ),
        )
        .returning({ id: purchases.id });
      return rows.length ? "updated" : "no_match";
    }
    case "PAYMENT.CAPTURE.DENIED":
    case "PAYMENT.CAPTURE.DECLINED": {
      if (!r.id) return "no_match";
      const rows = await db
        .update(purchases)
        .set({ status: "failed", error: `PayPal ${ev.event_type}`, updatedAt: now })
        .where(eq(purchases.paypalCaptureId, r.id))
        .returning({ id: purchases.id });
      return rows.length ? "updated" : "no_match";
    }
    case "PAYMENT.CAPTURE.REFUNDED":
    case "PAYMENT.CAPTURE.REVERSED": {
      const captureId = ev.event_type === "PAYMENT.CAPTURE.REVERSED" ? r.id : captureIdFromRefund(ev);
      if (!captureId) return "no_match";
      const [p] = await db.select().from(purchases).where(eq(purchases.paypalCaptureId, captureId));
      if (!p) return "no_match";
      const amount = r.amount?.value ? valueToCents(r.amount.value) : p.totalCents;
      const refunded = Math.min(p.totalCents, Math.max(p.refundedCents, amount));
      await db
        .update(purchases)
        .set({
          refundedCents: refunded,
          status: refunded >= p.totalCents ? "refunded" : p.status,
          paypalRefundId: ev.event_type === "PAYMENT.CAPTURE.REFUNDED" ? (r.id ?? p.paypalRefundId) : p.paypalRefundId,
          updatedAt: now,
        })
        .where(eq(purchases.id, p.id));
      return "updated";
    }
    case "VAULT.PAYMENT-TOKEN.DELETED": {
      if (!r.id) return "no_match";
      const rows = await db.update(workspaces).set({ vaultId: null }).where(eq(workspaces.vaultId, r.id)).returning({ id: workspaces.id });
      return rows.length ? "updated" : "no_match";
    }
    default:
      return "ignored";
  }
}
