/**
 * Day-1 go/no-go: proves every PayPal flow Leash depends on, against YOUR sandbox.
 *
 *   npm run spike:paypal
 *
 * Steps (each prints PASS/FAIL):
 *   1. OAuth client-credentials token
 *   2. Vault: create setup token -> you approve in browser -> create payment token
 *   3. Merchant-initiated charge with vault_id (no buyer present)
 *   4. Idempotency: same PayPal-Request-Id returns the same order (no double charge)
 *   5. Step-up: buyer-approved order -> you approve in browser -> capture
 *   6. Refund the merchant-initiated capture
 *
 * The browser approvals need you to log in as your sandbox PERSONAL (buyer) account.
 * A tiny local server on :3999 catches PayPal's redirect so the script continues by itself.
 */
import { config } from "dotenv";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { PayPalClient, PayPalError } from "../src/lib/paypal/client";
import {
  captureOrder,
  chargeVaultedWallet,
  createApprovalOrder,
  createPayPalSetupToken,
  createPaymentTokenFromSetupToken,
  refundCapture,
} from "../src/lib/paypal/api";

config({ path: ".env.local" });

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name} in .env.local`);
    process.exit(1);
  }
  return v;
}

const pp = new PayPalClient({
  clientId: need("PAYPAL_CLIENT_ID"),
  clientSecret: need("PAYPAL_CLIENT_SECRET"),
  env: "sandbox",
});

const results: Record<string, unknown> = {};
const pass = (step: string, info: string) => console.log(`\x1b[32mPASS\x1b[0m ${step} — ${info}`);
const fail = (step: string, err: unknown) => {
  console.log(`\x1b[31mFAIL\x1b[0m ${step}`);
  if (err instanceof PayPalError) {
    console.log(`  ${err.message}\n  debug_id=${err.debugId}`);
    console.log(JSON.stringify(err.details, null, 2));
  } else console.log(err);
};

/** Wait for PayPal to redirect the browser to BASE+path; resolve with the query params. */
function waitForRedirect(path: string, cancelPath: string): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", BASE);
      if (url.pathname === path || url.pathname === cancelPath) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h2>Got it — return to your terminal.</h2>");
        server.close();
        if (url.pathname === cancelPath) reject(new Error("Payer cancelled"));
        else resolve(url.searchParams);
      } else {
        res.writeHead(404).end();
      }
    });
    server.listen(PORT);
  });
}

async function main() {
  // 1. OAuth
  try {
    await pp.accessToken();
    pass("1 OAuth", "got sandbox access token");
  } catch (e) {
    fail("1 OAuth", e);
    return;
  }

  // 2. Vault
  let vaultId: string;
  try {
    const st = await createPayPalSetupToken(pp, {
      returnUrl: `${BASE}/vault-return`,
      cancelUrl: `${BASE}/vault-cancel`,
    });
    console.log(`\nOpen this URL, log in as your sandbox BUYER, and approve saving PayPal:\n\n  ${st.approveUrl}\n`);
    const params = await waitForRedirect("/vault-return", "/vault-cancel");
    console.log(`  redirect params: ${[...params.keys()].join(", ")}`);
    const pt = await createPaymentTokenFromSetupToken(pp, st.id);
    vaultId = pt.vaultId;
    results.vault = pt;
    pass("2 Vault", `payment token ${pt.vaultId} (customer ${pt.customerId}, payer ${pt.payerEmail})`);
  } catch (e) {
    fail("2 Vault", e);
    console.log("\nVault is the go/no-go. Check: Developer Dashboard > Apps > your sandbox app > Features > 'Vault' / 'Save payment methods' is enabled.");
    return;
  }

  // 3. Merchant-initiated charge
  const key = `spike-mit-${randomUUID()}`;
  let mitCaptureId: string | undefined;
  try {
    const c = await chargeVaultedWallet(pp, {
      vaultId,
      items: [{ name: "Oat milk 1L (spike test)", unitCents: 450, quantity: 1 }],
      referenceId: "spike-mit",
      description: "Leash spike: merchant-initiated charge",
      idempotencyKey: key,
    });
    results.mit = { orderId: c.orderId, status: c.status, captureId: c.captureId, captureStatus: c.captureStatus };
    if (c.status !== "COMPLETED" || c.captureStatus !== "COMPLETED") throw new Error(`Unexpected status ${c.status}/${c.captureStatus}`);
    mitCaptureId = c.captureId;
    pass("3 MIT charge", `order ${c.orderId} captured ${c.amountCents}¢ (capture ${c.captureId})`);

    // 4. Idempotency
    const again = await chargeVaultedWallet(pp, {
      vaultId,
      items: [{ name: "Oat milk 1L (spike test)", unitCents: 450, quantity: 1 }],
      referenceId: "spike-mit",
      description: "Leash spike: merchant-initiated charge",
      idempotencyKey: key,
    });
    if (again.orderId !== c.orderId) throw new Error(`Retry created a NEW order ${again.orderId} != ${c.orderId}`);
    pass("4 Idempotency", "retry with same PayPal-Request-Id returned the same order");
  } catch (e) {
    fail("3/4 MIT charge", e);
  }

  // 5. Step-up approval order
  try {
    const o = await createApprovalOrder(pp, {
      items: [{ name: "Espresso grinder (spike test)", unitCents: 6000, quantity: 1 }],
      referenceId: "spike-stepup",
      description: "Leash spike: buyer-approved purchase",
      idempotencyKey: `spike-step-${randomUUID()}`,
      returnUrl: `${BASE}/order-return`,
      cancelUrl: `${BASE}/order-cancel`,
    });
    console.log(`\nOpen this URL and approve the $60.00 payment as the sandbox BUYER:\n\n  ${o.approveUrl}\n`);
    const params = await waitForRedirect("/order-return", "/order-cancel");
    if (params.get("token") !== o.orderId) console.log(`  note: token param ${params.get("token")} != order ${o.orderId}`);
    const cap = await captureOrder(pp, o.orderId);
    results.stepUp = { orderId: cap.orderId, status: cap.status, captureId: cap.captureId };
    if (cap.status !== "COMPLETED") throw new Error(`Unexpected status ${cap.status}`);
    pass("5 Step-up", `order ${cap.orderId} approved by buyer and captured ${cap.amountCents}¢`);
  } catch (e) {
    fail("5 Step-up", e);
  }

  // 6. Refund
  if (mitCaptureId) {
    try {
      const r = await refundCapture(pp, mitCaptureId, { idempotencyKey: `spike-ref-${mitCaptureId}`, note: "Spike refund" });
      results.refund = r;
      pass("6 Refund", `refund ${r.refundId} ${r.status} ${r.amountCents}¢`);
    } catch (e) {
      fail("6 Refund", e);
    }
  }

  writeFileSync("scripts/.spike-result.json", JSON.stringify(results, null, 2));
  console.log("\nSaved scripts/.spike-result.json");
}

main().then(() => process.exit(0));
