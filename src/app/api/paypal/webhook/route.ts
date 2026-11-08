import { db } from "@/db";
import { verifyWebhookSignature } from "@/lib/paypal/api";
import { handleWebhookEvent, type PayPalWebhookEvent } from "@/lib/purchases/webhooks";
import { configured } from "@/lib/server/env";
import { json } from "@/lib/server/http";
import { paypal } from "@/lib/server/paypal";

/** PayPal webhook events are small; anything larger is not from PayPal. */
const MAX_BODY = 64 * 1024;

/** PayPal webhook listener. Unverified events are logged, never stored or acted on. */
export async function POST(req: Request) {
  let event: PayPalWebhookEvent;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return json({ error: "Payload too large" }, 413);
    event = JSON.parse(raw) as PayPalWebhookEvent;
    if (!event?.id || !event?.event_type) return json({ error: "Not a PayPal event" }, 400);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  let verified = false;
  if (configured("webhooks") && configured("paypal")) {
    try {
      verified = await verifyWebhookSignature(paypal(), { webhookId: process.env.PAYPAL_WEBHOOK_ID!, headers: req.headers, event });
    } catch (e) {
      console.error("[webhook] verification error", e);
    }
  }
  const outcome = await handleWebhookEvent(db, event, verified);
  console.log(`[webhook] ${event.event_type} ${event.id} verified=${verified} -> ${outcome}`);
  // 200 even when unverified so PayPal doesn't retry forever; we simply don't act on it.
  return json({ received: true, verified, outcome });
}
