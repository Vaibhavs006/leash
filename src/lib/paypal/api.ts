/**
 * PayPal operations Leash uses. Amounts are integer cents everywhere in Leash
 * and converted to PayPal's decimal strings only at this boundary.
 *
 * - Vault v3 (save PayPal without purchase): setup token -> payer approves -> payment token
 * - Orders v2 merchant-initiated charge with vault_id (payer not present)
 * - Orders v2 buyer-approved order (step-up approval) -> capture
 * - Payments v2 refund
 * - Webhook signature verification
 */
import { PayPalClient, findLink, type PayPalLink } from "./client";

export function centsToValue(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`Invalid cents amount: ${cents}`);
  return (cents / 100).toFixed(2);
}

export function valueToCents(value: string): number {
  const [whole, frac = ""] = value.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

export interface LineItem {
  name: string;
  unitCents: number;
  quantity: number;
  sku?: string;
}

function purchaseUnit(items: LineItem[], opts: { referenceId: string; description: string }) {
  const total = items.reduce((s, i) => s + i.unitCents * i.quantity, 0);
  return {
    reference_id: opts.referenceId,
    description: opts.description.slice(0, 127),
    custom_id: opts.referenceId.slice(0, 127),
    amount: {
      currency_code: "USD",
      value: centsToValue(total),
      breakdown: { item_total: { currency_code: "USD", value: centsToValue(total) } },
    },
    items: items.map((i) => ({
      name: i.name.slice(0, 127),
      quantity: String(i.quantity),
      unit_amount: { currency_code: "USD", value: centsToValue(i.unitCents) },
      category: "PHYSICAL_GOODS",
      ...(i.sku ? { sku: i.sku.slice(0, 127) } : {}),
    })),
  };
}

// ---------- Vault v3 ----------

export interface SetupTokenResult {
  id: string;
  customerId: string | undefined;
  status: string;
  approveUrl: string;
}

export async function createPayPalSetupToken(
  pp: PayPalClient,
  opts: { returnUrl: string; cancelUrl: string; brandName?: string; customerId?: string },
): Promise<SetupTokenResult> {
  const res = await pp.request<{ id: string; status: string; customer?: { id: string }; links: PayPalLink[] }>(
    "POST",
    "/v3/vault/setup-tokens",
    {
      body: {
        ...(opts.customerId ? { customer: { id: opts.customerId } } : {}),
        payment_source: {
          paypal: {
            description: "Leash agent spending wallet",
            permit_multiple_payment_tokens: false,
            usage_pattern: "IMMEDIATE",
            usage_type: "MERCHANT",
            customer_type: "CONSUMER",
            experience_context: {
              brand_name: opts.brandName ?? "Leash",
              locale: "en-US",
              shipping_preference: "NO_SHIPPING",
              return_url: opts.returnUrl,
              cancel_url: opts.cancelUrl,
            },
          },
        },
      },
    },
  );
  const approveUrl = findLink(res.links, "approve");
  if (!approveUrl) throw new Error(`Setup token ${res.id} has no approve link (status ${res.status})`);
  return { id: res.id, customerId: res.customer?.id, status: res.status, approveUrl };
}

export interface PaymentTokenResult {
  vaultId: string;
  customerId: string | undefined;
  payerEmail: string | undefined;
}

export async function createPaymentTokenFromSetupToken(
  pp: PayPalClient,
  setupTokenId: string,
): Promise<PaymentTokenResult> {
  const res = await pp.request<{
    id: string;
    customer?: { id: string };
    payment_source?: { paypal?: { email_address?: string } };
  }>("POST", "/v3/vault/payment-tokens", {
    // Idempotent per setup token: retrying never creates a second token.
    requestId: `pt-${setupTokenId}`,
    body: { payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } } },
  });
  return {
    vaultId: res.id,
    customerId: res.customer?.id,
    payerEmail: res.payment_source?.paypal?.email_address,
  };
}

// ---------- Orders v2 ----------

export interface OrderCapture {
  orderId: string;
  status: string; // COMPLETED, PAYER_ACTION_REQUIRED, ...
  captureId: string | undefined;
  captureStatus: string | undefined; // COMPLETED, PENDING, DECLINED
  amountCents: number | undefined;
  raw: unknown;
}

interface OrderResponse {
  id: string;
  status: string;
  links?: PayPalLink[];
  purchase_units?: Array<{
    payments?: { captures?: Array<{ id: string; status: string; amount: { value: string } }> };
  }>;
}

function toCapture(res: OrderResponse): OrderCapture {
  const cap = res.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    orderId: res.id,
    status: res.status,
    captureId: cap?.id,
    captureStatus: cap?.status,
    amountCents: cap ? valueToCents(cap.amount.value) : undefined,
    raw: res,
  };
}

/**
 * Merchant-initiated charge against a vaulted PayPal wallet. With intent
 * CAPTURE and a vault_id, PayPal creates and captures in one call.
 * `idempotencyKey` must be stable per purchase so retries never double-charge.
 */
export async function chargeVaultedWallet(
  pp: PayPalClient,
  opts: { vaultId: string; items: LineItem[]; referenceId: string; description: string; idempotencyKey: string },
): Promise<OrderCapture> {
  const res = await pp.request<OrderResponse>("POST", "/v2/checkout/orders", {
    requestId: opts.idempotencyKey,
    body: {
      intent: "CAPTURE",
      purchase_units: [purchaseUnit(opts.items, opts)],
      payment_source: { paypal: { vault_id: opts.vaultId } },
    },
  });
  return toCapture(res);
}

/** Buyer-present order: payer must approve on PayPal, then we capture. */
export async function createApprovalOrder(
  pp: PayPalClient,
  opts: {
    items: LineItem[];
    referenceId: string;
    description: string;
    idempotencyKey: string;
    returnUrl: string;
    cancelUrl: string;
  },
): Promise<{ orderId: string; status: string; approveUrl: string }> {
  const res = await pp.request<OrderResponse>("POST", "/v2/checkout/orders", {
    requestId: opts.idempotencyKey,
    body: {
      intent: "CAPTURE",
      purchase_units: [purchaseUnit(opts.items, opts)],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Leash",
            locale: "en-US",
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW",
            return_url: opts.returnUrl,
            cancel_url: opts.cancelUrl,
          },
        },
      },
    },
  });
  const approveUrl = findLink(res.links, "payer-action", "approve");
  if (!approveUrl) throw new Error(`Order ${res.id} has no approval link (status ${res.status})`);
  return { orderId: res.id, status: res.status, approveUrl };
}

export async function captureOrder(pp: PayPalClient, orderId: string): Promise<OrderCapture> {
  const res = await pp.request<OrderResponse>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    requestId: `cap-${orderId}`,
    body: {},
  });
  return toCapture(res);
}

export async function getOrder(pp: PayPalClient, orderId: string): Promise<OrderResponse> {
  return pp.request<OrderResponse>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
}

// ---------- Refunds ----------

export async function refundCapture(
  pp: PayPalClient,
  captureId: string,
  opts: { idempotencyKey: string; note?: string },
): Promise<{ refundId: string; status: string; amountCents: number }> {
  const res = await pp.request<{ id: string; status: string; amount: { value: string } }>(
    "POST",
    `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
    { requestId: opts.idempotencyKey, body: opts.note ? { note_to_payer: opts.note.slice(0, 255) } : {} },
  );
  return { refundId: res.id, status: res.status, amountCents: valueToCents(res.amount.value) };
}

// ---------- Webhooks ----------

export async function verifyWebhookSignature(
  pp: PayPalClient,
  opts: { webhookId: string; headers: Headers; event: unknown },
): Promise<boolean> {
  const h = (name: string) => opts.headers.get(name) ?? "";
  const res = await pp.request<{ verification_status: string }>(
    "POST",
    "/v1/notifications/verify-webhook-signature",
    {
      body: {
        auth_algo: h("paypal-auth-algo"),
        cert_url: h("paypal-cert-url"),
        transmission_id: h("paypal-transmission-id"),
        transmission_sig: h("paypal-transmission-sig"),
        transmission_time: h("paypal-transmission-time"),
        webhook_id: opts.webhookId,
        webhook_event: opts.event,
      },
    },
  );
  return res.verification_status === "SUCCESS";
}

// ---------- Vault token management ----------

export async function deletePaymentToken(pp: PayPalClient, vaultId: string): Promise<void> {
  await pp.request("DELETE", `/v3/vault/payment-tokens/${encodeURIComponent(vaultId)}`);
}
