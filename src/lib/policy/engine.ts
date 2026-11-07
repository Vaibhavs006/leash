/**
 * Leash policy engine — the security boundary between the AI agent and money.
 *
 * Pure and deterministic: no I/O, no LLM, no clock reads (time is passed in).
 * The agent can only *propose* a cart; this function alone decides whether it
 * is charged automatically, escalated to a human, or denied. Every rule
 * produces a check record so the ledger can show exactly why.
 */

export type Decision = "AUTO_APPROVE" | "REQUIRE_APPROVAL" | "DENY";

export interface Mandate {
  id: string;
  status: "active" | "paused" | "revoked";
  /** Total the agent may spend over the mandate's lifetime. */
  budgetCents: number;
  /** Hard ceiling for a single purchase. Above this: DENY. */
  perPurchaseCapCents: number;
  /** At or below this (and every other rule passing): charge without asking. */
  autoApproveLimitCents: number;
  /** Max units of any single item in one purchase. */
  maxItemQuantity: number;
  /** Lower-case categories. Empty = any category allowed. */
  allowedCategories: string[];
  /** Lower-case merchant names. Empty = any merchant allowed (minus blocked). */
  allowedMerchants: string[];
  blockedMerchants: string[];
  expiresAt: Date;
}

/** A product the server itself fetched from the catalog during this run. */
export interface CatalogProduct {
  id: string;
  title: string;
  merchant: string;
  category: string;
  /** Extra category labels (taxonomy slug + path segments). Any match satisfies an allowlist. */
  categoryTags?: string[];
  priceCents: number;
}

/** What the agent proposes. Prices here are NOT trusted. */
export interface ProposedItem {
  productId: string;
  quantity: number;
  /** Price the agent claims; must match the catalog. */
  unitCents: number;
}

export interface PolicyContext {
  now: Date;
  /** Captured spend under this mandate (minus refunds). */
  spentCents: number;
  /** Spend awaiting human approval — reserved so parallel requests can't overspend. */
  pendingCents: number;
  /** Product ids purchased under this mandate in the last 24h. */
  recentProductIds: string[];
  /** Whether a saved PayPal wallet exists. Without it nothing can auto-charge. */
  hasVaultedWallet: boolean;
  /** Products the server saw from the catalog this run, by id. */
  catalog: ReadonlyMap<string, CatalogProduct>;
}

export type CheckSeverity = "deny" | "escalate";

export interface Check {
  rule: string;
  passed: boolean;
  detail: string;
  /** What a failure of this check does. */
  severity: CheckSeverity;
}

export interface PricedItem {
  product: CatalogProduct;
  quantity: number;
  lineCents: number;
}

export interface PolicyResult {
  decision: Decision;
  totalCents: number;
  items: PricedItem[];
  checks: Check[];
  /** Human-readable reasons for a non-auto decision. */
  reasons: string[];
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const norm = (s: string) => s.trim().toLowerCase();

export function evaluatePurchase(mandate: Mandate, proposed: ProposedItem[], ctx: PolicyContext): PolicyResult {
  const checks: Check[] = [];
  const add = (rule: string, passed: boolean, detail: string, severity: CheckSeverity = "deny") =>
    checks.push({ rule, passed, detail, severity });

  // --- Mandate state ---
  add("mandate_active", mandate.status === "active", `Mandate is ${mandate.status}`);
  add(
    "mandate_not_expired",
    ctx.now.getTime() < mandate.expiresAt.getTime(),
    `Expires ${mandate.expiresAt.toISOString()}`,
  );

  // --- Cart shape ---
  add("cart_not_empty", proposed.length > 0, `${proposed.length} line item(s)`);
  const ids = proposed.map((p) => p.productId);
  add("no_duplicate_lines", new Set(ids).size === ids.length, "Each product appears once");

  // --- Items: must be real catalog products at real prices ---
  const items: PricedItem[] = [];
  for (const p of proposed) {
    const product = ctx.catalog.get(p.productId);
    if (!product) {
      add("item_from_catalog", false, `Product ${p.productId} was never returned by catalog search`);
      continue;
    }
    add("item_from_catalog", true, `"${product.title}" found in catalog`);

    const qtyOk = Number.isInteger(p.quantity) && p.quantity >= 1 && p.quantity <= mandate.maxItemQuantity;
    add("item_quantity", qtyOk, `${p.quantity} × "${product.title}" (max ${mandate.maxItemQuantity})`);

    add(
      "item_price_matches",
      p.unitCents === product.priceCents,
      p.unitCents === product.priceCents
        ? `${usd(product.priceCents)} matches catalog`
        : `Agent claimed ${usd(p.unitCents)} but catalog price is ${usd(product.priceCents)}`,
    );

    const tags = [product.category, ...(product.categoryTags ?? [])].map(norm);
    const allowedCats = mandate.allowedCategories.map(norm);
    const catOk = allowedCats.length === 0 || tags.some((t) => allowedCats.includes(t));
    add("item_category_allowed", catOk, `Category "${product.category}"`);

    const merchant = norm(product.merchant);
    const blocked = mandate.blockedMerchants.map(norm).includes(merchant);
    const allowed = mandate.allowedMerchants.length === 0 || mandate.allowedMerchants.map(norm).includes(merchant);
    add("item_merchant_allowed", !blocked && allowed, `Merchant "${product.merchant}"${blocked ? " is blocked" : ""}`);

    // Price every positive-integer quantity (even over the limit) so totals reflect what was
    // actually attempted: a hijacked agent asking for 10 units is shown as 10 x catalog price.
    if (Number.isInteger(p.quantity) && p.quantity >= 1) items.push({ product, quantity: p.quantity, lineCents: product.priceCents * p.quantity });
  }

  // Totals always use CATALOG prices, never the agent's numbers.
  const totalCents = items.reduce((s, i) => s + i.lineCents, 0);

  // --- Money ---
  add(
    "per_purchase_cap",
    totalCents <= mandate.perPurchaseCapCents,
    `${usd(totalCents)} vs cap ${usd(mandate.perPurchaseCapCents)}`,
  );
  const remaining = mandate.budgetCents - ctx.spentCents - ctx.pendingCents;
  add(
    "within_budget",
    totalCents <= remaining,
    `${usd(totalCents)} vs ${usd(Math.max(0, remaining))} remaining of ${usd(mandate.budgetCents)}`,
  );

  // --- Escalations (human can override) ---
  add(
    "auto_approve_limit",
    totalCents <= mandate.autoApproveLimitCents,
    `${usd(totalCents)} vs auto-approve limit ${usd(mandate.autoApproveLimitCents)}`,
    "escalate",
  );
  const dupes = items.filter((i) => ctx.recentProductIds.includes(i.product.id));
  add(
    "no_recent_duplicate",
    dupes.length === 0,
    dupes.length ? `Bought in last 24h: ${dupes.map((d) => d.product.title).join(", ")}` : "No repeat purchases in 24h",
    "escalate",
  );
  add(
    "wallet_connected",
    ctx.hasVaultedWallet,
    ctx.hasVaultedWallet ? "Saved PayPal wallet available" : "No saved wallet — buyer must approve on PayPal",
    "escalate",
  );

  const failed = checks.filter((c) => !c.passed);
  const denied = failed.filter((c) => c.severity === "deny");
  const escalated = failed.filter((c) => c.severity === "escalate");

  const decision: Decision = denied.length > 0 ? "DENY" : escalated.length > 0 ? "REQUIRE_APPROVAL" : "AUTO_APPROVE";
  const reasons = (denied.length > 0 ? denied : escalated).map((c) => c.detail);

  return { decision, totalCents, items, checks, reasons };
}

/** The failures that explain a decision: hard denials for DENY, escalations for REQUIRE_APPROVAL. */
export function decisiveFailures(r: PolicyResult): Check[] {
  const failed = r.checks.filter((c) => !c.passed);
  return r.decision === "DENY" ? failed.filter((c) => c.severity === "deny") : failed;
}
