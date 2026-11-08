/**
 * Purchase lifecycle: policy decision -> (auto charge | human approval -> PayPal buyer approval -> capture) -> refund.
 *
 * Budget safety: every decision runs inside a transaction holding a row lock on
 * the mandate, and in-flight/pending purchases are counted against the budget,
 * so concurrent agent requests can never overspend.
 */
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import { catalogSnapshots, mandates, purchases, workspaces, type Purchase, type PurchaseItem } from "@/db/schema";
import { evaluatePurchase, type CatalogProduct, type Mandate, type PolicyResult, type ProposedItem } from "@/lib/policy/engine";

type DB = PostgresJsDatabase<typeof schema>;

/** The PayPal operations the service needs — real impl in gateway.ts, fake in tests. */
export interface PaymentGateway {
  chargeVault(args: { vaultId: string; items: PurchaseItem[]; purchaseId: string; description: string }): Promise<{
    orderId: string;
    captureId?: string;
    status: string;
    captureStatus?: string;
  }>;
  createApprovalOrder(args: { items: PurchaseItem[]; purchaseId: string; description: string; returnUrl: string; cancelUrl: string }): Promise<{
    orderId: string;
    approveUrl: string;
  }>;
  captureOrder(orderId: string): Promise<{ orderId: string; captureId?: string; status: string; captureStatus?: string }>;
  refund(captureId: string, purchaseId: string): Promise<{ refundId: string; status: string; amountCents: number }>;
}

export interface ServiceDeps {
  db: DB;
  gateway: PaymentGateway;
  appUrl: string;
  now?: () => Date;
}

const SPENT_STATUSES = ["captured", "refunded"] as const;
const RESERVED_STATUSES = ["processing", "pending_approval", "awaiting_payer"] as const;

function toMandate(row: typeof mandates.$inferSelect): Mandate {
  return {
    id: row.id,
    status: row.status,
    budgetCents: row.budgetCents,
    perPurchaseCapCents: row.perPurchaseCapCents,
    autoApproveLimitCents: row.autoApproveLimitCents,
    maxItemQuantity: row.maxItemQuantity,
    allowedCategories: row.allowedCategories,
    allowedMerchants: row.allowedMerchants,
    blockedMerchants: row.blockedMerchants,
    expiresAt: row.expiresAt,
  };
}

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

export async function mandateSpend(tx: Tx | DB, mandateId: string, excludePurchaseId?: string) {
  const rows = await tx
    .select({ status: purchases.status, total: purchases.totalCents, refunded: purchases.refundedCents, id: purchases.id })
    .from(purchases)
    .where(eq(purchases.mandateId, mandateId));
  let spentCents = 0;
  let pendingCents = 0;
  for (const r of rows) {
    if (r.id === excludePurchaseId) continue;
    if ((SPENT_STATUSES as readonly string[]).includes(r.status)) spentCents += r.total - r.refunded;
    else if ((RESERVED_STATUSES as readonly string[]).includes(r.status)) pendingCents += r.total;
  }
  return { spentCents, pendingCents };
}

async function policyContextInputs(tx: Tx, mandateId: string, runId: string, now: Date, excludePurchaseId?: string) {
  const { spentCents, pendingCents } = await mandateSpend(tx, mandateId, excludePurchaseId);
  const since = new Date(now.getTime() - 24 * 3600 * 1000);
  const recent = await tx
    .select({ items: purchases.items })
    .from(purchases)
    .where(and(eq(purchases.mandateId, mandateId), inArray(purchases.status, ["captured", "processing", "awaiting_payer"]), gte(purchases.createdAt, since)));
  const recentProductIds = recent.flatMap((r) => r.items.map((it) => it.productId));
  const snap = await tx.select().from(catalogSnapshots).where(eq(catalogSnapshots.runId, runId));
  const catalog = new Map<string, CatalogProduct>(
    snap.map((s) => [
      s.productId,
      { id: s.productId, title: s.title, merchant: s.merchant, category: s.category, categoryTags: s.categoryTags, priceCents: s.priceCents },
    ]),
  );
  return { spentCents, pendingCents, recentProductIds, catalog, snap };
}

export interface RequestPurchaseResult {
  purchase: Purchase;
  policy: PolicyResult;
}

export async function requestPurchase(
  deps: ServiceDeps,
  args: {
    workspaceId: string;
    mandateId: string;
    runId: string;
    items: ProposedItem[];
    agentReason: string;
    idempotencyKey: string;
    /** True when payments run through the offline simulator. */
    simulated?: boolean;
  },
): Promise<RequestPurchaseResult> {
  const simulated = !!args.simulated;
  const now = deps.now?.() ?? new Date();

  const { purchase, policy, vaultId } = await deps.db.transaction(async (tx) => {
    // Idempotent: the same agent tool call never creates two purchases.
    const existing = await tx.select().from(purchases).where(eq(purchases.idempotencyKey, args.idempotencyKey));
    if (existing[0]) throw new DuplicateRequestError(existing[0]);

    const [m] = await tx
      .select()
      .from(mandates)
      .where(and(eq(mandates.id, args.mandateId), eq(mandates.workspaceId, args.workspaceId)))
      .for("update");
    if (!m) throw new Error("Mandate not found");
    const [ws] = await tx.select().from(workspaces).where(eq(workspaces.id, args.workspaceId));

    const inputs = await policyContextInputs(tx, m.id, args.runId, now);
    // A simulated wallet only pays simulated purchases, and a real one only real purchases.
    const usableVaultId = ws?.vaultId && ws.walletSimulated === simulated ? ws.vaultId : null;
    const policy = evaluatePurchase(toMandate(m), args.items, {
      now,
      spentCents: inputs.spentCents,
      pendingCents: inputs.pendingCents,
      recentProductIds: inputs.recentProductIds,
      hasVaultedWallet: !!usableVaultId,
      catalog: inputs.catalog,
    });

    const snapById = new Map(inputs.snap.map((s) => [s.productId, s]));
    const items: PurchaseItem[] = policy.items.map((i) => {
      const s = snapById.get(i.product.id);
      return {
        productId: i.product.id,
        title: i.product.title,
        merchant: i.product.merchant,
        category: i.product.category,
        categoryTags: i.product.categoryTags ?? [],
        unitCents: i.product.priceCents,
        quantity: i.quantity,
        imageUrl: s?.imageUrl,
        url: s?.url,
      };
    });

    const status = policy.decision === "DENY" ? "denied" : policy.decision === "REQUIRE_APPROVAL" ? "pending_approval" : "processing";
    const [row] = await tx
      .insert(purchases)
      .values({
        workspaceId: args.workspaceId,
        mandateId: m.id,
        runId: args.runId,
        status,
        decision: policy.decision,
        paymentMode: policy.decision === "AUTO_APPROVE" ? "vault" : null,
        totalCents: policy.totalCents,
        items,
        checks: policy.checks,
        reasons: policy.reasons,
        agentReason: args.agentReason.slice(0, 2000),
        idempotencyKey: args.idempotencyKey,
        simulated,
      })
      .returning();
    return { purchase: row, policy, vaultId: usableVaultId };
  });

  if (policy.decision !== "AUTO_APPROVE" || !vaultId) return { purchase, policy };

  // Outside the transaction: never hold a DB lock across a network call.
  const charged = await chargeAndRecord(deps, purchase, vaultId);
  return { purchase: charged, policy };
}

export class DuplicateRequestError extends Error {
  constructor(public readonly purchase: Purchase) {
    super("Duplicate purchase request");
  }
}

function describe(p: Purchase): string {
  return `Leash agent purchase ${p.id.slice(0, 8)}`;
}

async function update(deps: ServiceDeps, id: string, values: Partial<typeof purchases.$inferInsert>): Promise<Purchase> {
  const [row] = await deps.db
    .update(purchases)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(purchases.id, id))
    .returning();
  return row;
}

async function chargeAndRecord(deps: ServiceDeps, p: Purchase, vaultId: string): Promise<Purchase> {
  try {
    const r = await deps.gateway.chargeVault({ vaultId, items: p.items, purchaseId: p.id, description: describe(p) });
    const ok = r.status === "COMPLETED" && r.captureStatus === "COMPLETED";
    return update(deps, p.id, {
      status: ok ? "captured" : r.captureStatus === "PENDING" ? "processing" : "failed",
      paypalOrderId: r.orderId,
      paypalCaptureId: r.captureId,
      error: ok ? null : `PayPal returned ${r.status}/${r.captureStatus ?? "no capture"}`,
    });
  } catch (e) {
    const err = e as { message?: string; debugId?: string };
    return update(deps, p.id, { status: "failed", error: err.message ?? String(e), paypalDebugId: err.debugId });
  }
}

async function loadOwned(deps: ServiceDeps, workspaceId: string, purchaseId: string): Promise<Purchase> {
  const [p] = await deps.db
    .select()
    .from(purchases)
    .where(and(eq(purchases.id, purchaseId), eq(purchases.workspaceId, workspaceId)));
  if (!p) throw new Error("Purchase not found");
  return p;
}

/**
 * Human approves an escalated purchase. Hard rules (budget, cap, mandate state,
 * allowlists) are re-checked now — only escalations are overridable. The
 * payment itself is then approved by the buyer on PayPal (customer-initiated).
 */
export async function approvePurchase(
  deps: ServiceDeps,
  workspaceId: string,
  purchaseId: string,
): Promise<{ purchase: Purchase; approveUrl?: string }> {
  const now = deps.now?.() ?? new Date();
  const p = await deps.db.transaction(async (tx) => {
    const [p] = await tx
      .select()
      .from(purchases)
      .where(and(eq(purchases.id, purchaseId), eq(purchases.workspaceId, workspaceId)))
      .for("update");
    if (!p) throw new Error("Purchase not found");
    if (p.status !== "pending_approval") throw new Error(`Purchase is ${p.status}, not awaiting approval`);
    const [m] = await tx.select().from(mandates).where(eq(mandates.id, p.mandateId)).for("update");
    const { spentCents, pendingCents } = await mandateSpend(tx, m.id, p.id);
    const catalog = new Map<string, CatalogProduct>(
      p.items.map((i) => [
        i.productId,
        { id: i.productId, title: i.title, merchant: i.merchant, category: i.category, categoryTags: i.categoryTags ?? [], priceCents: i.unitCents },
      ]),
    );
    // Re-run every hard rule against the CURRENT mandate (it may have been paused or tightened since).
    const recheck = evaluatePurchase(
      toMandate(m),
      p.items.map((i) => ({ productId: i.productId, quantity: i.quantity, unitCents: i.unitCents })),
      { now, spentCents, pendingCents, recentProductIds: [], hasVaultedWallet: true, catalog },
    );
    const hard = recheck.checks.filter((c) => !c.passed && c.severity === "deny");
    if (hard.length) {
      const [row] = await tx
        .update(purchases)
        .set({ status: "denied", reasons: hard.map((c) => c.detail), updatedAt: new Date() })
        .where(eq(purchases.id, p.id))
        .returning();
      return row;
    }
    const [row] = await tx
      .update(purchases)
      .set({ status: "awaiting_payer", paymentMode: "buyer_approval", updatedAt: new Date() })
      .where(eq(purchases.id, p.id))
      .returning();
    return row;
  });

  if (p.status !== "awaiting_payer") return { purchase: p };

  try {
    const order = await deps.gateway.createApprovalOrder({
      items: p.items,
      purchaseId: p.id,
      description: describe(p),
      returnUrl: `${deps.appUrl}/api/paypal/return?purchase=${p.id}`,
      cancelUrl: `${deps.appUrl}/api/paypal/cancel?purchase=${p.id}`,
    });
    const row = await update(deps, p.id, { paypalOrderId: order.orderId, paypalApproveUrl: order.approveUrl, error: null });
    return { purchase: row, approveUrl: order.approveUrl };
  } catch (e) {
    const err = e as { message?: string; debugId?: string };
    // Put it back so the human can retry.
    const row = await update(deps, p.id, { status: "pending_approval", error: err.message ?? String(e), paypalDebugId: err.debugId });
    return { purchase: row };
  }
}

/** PayPal redirected the buyer back after approving: capture the order. */
export async function completeBuyerApproval(deps: ServiceDeps, purchaseId: string, orderId: string): Promise<Purchase> {
  const [p] = await deps.db.select().from(purchases).where(eq(purchases.id, purchaseId));
  if (!p) throw new Error("Purchase not found");
  if (p.paypalOrderId !== orderId) throw new Error("Order does not match purchase");
  if (p.status === "captured") return p; // idempotent on refresh
  if (p.status !== "awaiting_payer") throw new Error(`Purchase is ${p.status}`);
  try {
    const r = await deps.gateway.captureOrder(orderId);
    const ok = r.status === "COMPLETED" && r.captureStatus === "COMPLETED";
    if (ok) return update(deps, p.id, { status: "captured", paypalCaptureId: r.captureId, paypalApproveUrl: null, error: null });
    if (r.captureStatus === "PENDING") return update(deps, p.id, { paypalCaptureId: r.captureId, error: "Capture pending at PayPal; waiting for webhook" });
    return backToQueue(deps, p.id, `PayPal returned ${r.status}/${r.captureStatus ?? "no capture"}`);
  } catch (e) {
    // E.g. ORDER_NOT_APPROVED (return URL hit without approving) or INSTRUMENT_DECLINED.
    // Don't mark the purchase failed: return it to the owner's queue (budget stays reserved)
    // so they can retry with a fresh PayPal order or reject it.
    const err = e as { message?: string; debugId?: string };
    return backToQueue(deps, p.id, err.message ?? String(e), err.debugId);
  }
}

function backToQueue(deps: ServiceDeps, id: string, error: string, debugId?: string) {
  return update(deps, id, { status: "pending_approval", paypalOrderId: null, paypalApproveUrl: null, error, paypalDebugId: debugId ?? null });
}

export async function cancelBuyerApproval(deps: ServiceDeps, purchaseId: string): Promise<Purchase | null> {
  const rows = await deps.db
    .update(purchases)
    .set({ status: "pending_approval", paypalOrderId: null, paypalApproveUrl: null, updatedAt: new Date() })
    .where(and(eq(purchases.id, purchaseId), eq(purchases.status, "awaiting_payer")))
    .returning();
  return rows[0] ?? null;
}

export async function rejectPurchase(deps: ServiceDeps, workspaceId: string, purchaseId: string): Promise<Purchase> {
  const p = await loadOwned(deps, workspaceId, purchaseId);
  if (p.status !== "pending_approval" && p.status !== "awaiting_payer") throw new Error(`Purchase is ${p.status}`);
  return update(deps, p.id, { status: "rejected" });
}

export async function refundPurchase(deps: ServiceDeps, workspaceId: string, purchaseId: string): Promise<Purchase> {
  const p = await loadOwned(deps, workspaceId, purchaseId);
  if (p.status !== "captured" || !p.paypalCaptureId) throw new Error(`Purchase is ${p.status}; only captured purchases can be refunded`);
  try {
    const r = await deps.gateway.refund(p.paypalCaptureId, p.id);
    return update(deps, p.id, {
      status: r.amountCents >= p.totalCents ? "refunded" : "captured",
      refundedCents: r.amountCents,
      paypalRefundId: r.refundId,
    });
  } catch (e) {
    const err = e as { message?: string; debugId?: string };
    throw new Error(`Refund failed: ${err.message ?? String(e)}${err.debugId ? ` (debug_id ${err.debugId})` : ""}`);
  }
}

/** Snapshot products the server fetched, so the policy engine can verify the agent's cart. */
export async function recordCatalog(
  db: DB,
  runId: string,
  products: Array<{ id: string; title: string; merchant: string; category: string; categoryTags: string[]; priceCents: number; imageUrl: string | null; url: string; injected?: boolean }>,
) {
  if (!products.length) return;
  await db
    .insert(catalogSnapshots)
    .values(
      products.map((p) => ({
        runId,
        productId: p.id,
        title: p.title,
        merchant: p.merchant,
        category: p.category,
        categoryTags: p.categoryTags,
        priceCents: p.priceCents,
        imageUrl: p.imageUrl,
        url: p.url,
        injected: p.injected ?? false,
      })),
    )
    .onConflictDoUpdate({
      target: [catalogSnapshots.runId, catalogSnapshots.productId],
      set: {
        priceCents: sql`excluded.price_cents`,
        title: sql`excluded.title`,
        merchant: sql`excluded.merchant`,
        category: sql`excluded.category`,
        categoryTags: sql`excluded.category_tags`,
      },
    });
}
