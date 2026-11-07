import { describe, expect, it } from "vitest";
import { evaluatePurchase, type CatalogProduct, type Mandate, type PolicyContext } from "./engine";

const NOW = new Date("2026-11-08T12:00:00Z");

const beans: CatalogProduct = { id: "p_beans", title: "Espresso beans 1kg", merchant: "Roastery Co", category: "Coffee", priceCents: 2400 };
const milk: CatalogProduct = { id: "p_milk", title: "Oat milk 1L", merchant: "GroceryMart", category: "Grocery", priceCents: 450 };
const grinder: CatalogProduct = { id: "p_grinder", title: "Burr grinder", merchant: "Roastery Co", category: "Coffee", priceCents: 8900 };
const tv: CatalogProduct = { id: "p_tv", title: "65in TV", merchant: "ElectroWorld", category: "Electronics", priceCents: 4000 };
const shady: CatalogProduct = { id: "p_shady", title: "Beans (bulk)", merchant: "ShadyDeals", category: "Coffee", priceCents: 1000 };

function mandate(over: Partial<Mandate> = {}): Mandate {
  return {
    id: "m1",
    status: "active",
    budgetCents: 20000,
    perPurchaseCapCents: 10000,
    autoApproveLimitCents: 5000,
    maxItemQuantity: 5,
    allowedCategories: ["coffee", "grocery"],
    allowedMerchants: [],
    blockedMerchants: ["shadydeals"],
    expiresAt: new Date("2026-11-15T00:00:00Z"),
    ...over,
  };
}

function ctx(over: Partial<PolicyContext> = {}): PolicyContext {
  return {
    now: NOW,
    spentCents: 0,
    pendingCents: 0,
    recentProductIds: [],
    hasVaultedWallet: true,
    catalog: new Map([beans, milk, grinder, tv, shady].map((p) => [p.id, p])),
    ...over,
  };
}

const failedRules = (r: ReturnType<typeof evaluatePurchase>) => r.checks.filter((c) => !c.passed).map((c) => c.rule);

describe("evaluatePurchase", () => {
  it("auto-approves a small, compliant cart and totals with catalog prices", () => {
    const r = evaluatePurchase(mandate(), [
      { productId: "p_beans", quantity: 1, unitCents: 2400 },
      { productId: "p_milk", quantity: 2, unitCents: 450 },
    ], ctx());
    expect(r.decision).toBe("AUTO_APPROVE");
    expect(r.totalCents).toBe(3300);
    expect(failedRules(r)).toEqual([]);
  });

  it("auto-approves exactly at the auto-approve limit (boundary is inclusive)", () => {
    const m = mandate({ autoApproveLimitCents: 2400 });
    expect(evaluatePurchase(m, [{ productId: "p_beans", quantity: 1, unitCents: 2400 }], ctx()).decision).toBe("AUTO_APPROVE");
  });

  it("escalates to human approval above the auto-approve limit but within cap", () => {
    const r = evaluatePurchase(mandate(), [{ productId: "p_grinder", quantity: 1, unitCents: 8900 }], ctx());
    expect(r.decision).toBe("REQUIRE_APPROVAL");
    expect(failedRules(r)).toEqual(["auto_approve_limit"]);
  });

  it("denies above the per-purchase cap even though a human could approve smaller ones", () => {
    const r = evaluatePurchase(mandate(), [
      { productId: "p_grinder", quantity: 1, unitCents: 8900 },
      { productId: "p_beans", quantity: 1, unitCents: 2400 },
    ], ctx());
    expect(r.decision).toBe("DENY");
    expect(failedRules(r)).toContain("per_purchase_cap");
  });

  it("denies when the purchase would exceed remaining budget, counting pending approvals", () => {
    const r = evaluatePurchase(mandate(), [{ productId: "p_beans", quantity: 1, unitCents: 2400 }], ctx({ spentCents: 15000, pendingCents: 3000 }));
    expect(r.decision).toBe("DENY");
    expect(failedRules(r)).toContain("within_budget");
  });

  it("allows spending exactly the remaining budget", () => {
    const r = evaluatePurchase(mandate(), [{ productId: "p_beans", quantity: 1, unitCents: 2400 }], ctx({ spentCents: 17600 }));
    expect(r.decision).toBe("AUTO_APPROVE");
  });

  it("denies products the catalog never returned (agent cannot invent items)", () => {
    const r = evaluatePurchase(mandate(), [{ productId: "p_fake", quantity: 1, unitCents: 1 }], ctx());
    expect(r.decision).toBe("DENY");
    expect(failedRules(r)).toContain("item_from_catalog");
  });

  it("denies when the agent misstates the price, and never uses the agent's price", () => {
    const r = evaluatePurchase(mandate(), [{ productId: "p_grinder", quantity: 1, unitCents: 100 }], ctx());
    expect(r.decision).toBe("DENY");
    expect(failedRules(r)).toContain("item_price_matches");
    expect(r.totalCents).toBe(8900);
  });

  it("denies disallowed categories", () => {
    const r = evaluatePurchase(mandate(), [{ productId: "p_tv", quantity: 1, unitCents: 4000 }], ctx());
    expect(r.decision).toBe("DENY");
    expect(failedRules(r)).toEqual(["item_category_allowed"]);
  });

  it("matches category allowlists against taxonomy tags too", () => {
    const bag: CatalogProduct = { id: "p_bag", title: "Coffee filters", merchant: "Shop", category: "Paper Filters", categoryTags: ["coffee"], priceCents: 500 };
    const r = evaluatePurchase(mandate(), [{ productId: "p_bag", quantity: 1, unitCents: 500 }], ctx({ catalog: new Map([[bag.id, bag]]) }));
    expect(r.decision).toBe("AUTO_APPROVE");
  });

  it("allows any category when the allowlist is empty", () => {
    const r = evaluatePurchase(mandate({ allowedCategories: [] }), [{ productId: "p_tv", quantity: 1, unitCents: 4000 }], ctx());
    expect(r.decision).toBe("AUTO_APPROVE");
  });

  it("denies blocked merchants case-insensitively", () => {
    const r = evaluatePurchase(mandate(), [{ productId: "p_shady", quantity: 1, unitCents: 1000 }], ctx());
    expect(r.decision).toBe("DENY");
    expect(failedRules(r)).toEqual(["item_merchant_allowed"]);
  });

  it("enforces a merchant allowlist when set", () => {
    const r = evaluatePurchase(mandate({ allowedMerchants: ["Roastery Co"] }), [{ productId: "p_milk", quantity: 1, unitCents: 450 }], ctx());
    expect(r.decision).toBe("DENY");
    expect(failedRules(r)).toEqual(["item_merchant_allowed"]);
  });

  it.each([0, -1, 1.5, 6])("denies invalid or excessive quantity %s", (q) => {
    const r = evaluatePurchase(mandate(), [{ productId: "p_milk", quantity: q, unitCents: 450 }], ctx());
    expect(r.decision).toBe("DENY");
    expect(failedRules(r)).toContain("item_quantity");
  });

  it("denies an empty cart", () => {
    expect(evaluatePurchase(mandate(), [], ctx()).decision).toBe("DENY");
  });

  it("denies duplicate lines (quantity splitting to dodge per-item limits)", () => {
    const r = evaluatePurchase(mandate(), [
      { productId: "p_milk", quantity: 5, unitCents: 450 },
      { productId: "p_milk", quantity: 5, unitCents: 450 },
    ], ctx());
    expect(r.decision).toBe("DENY");
    expect(failedRules(r)).toContain("no_duplicate_lines");
  });

  it("denies paused, revoked and expired mandates", () => {
    const cart = [{ productId: "p_milk", quantity: 1, unitCents: 450 }];
    expect(evaluatePurchase(mandate({ status: "paused" }), cart, ctx()).decision).toBe("DENY");
    expect(evaluatePurchase(mandate({ status: "revoked" }), cart, ctx()).decision).toBe("DENY");
    expect(evaluatePurchase(mandate({ expiresAt: NOW }), cart, ctx()).decision).toBe("DENY");
  });

  it("escalates a repeat purchase within 24h instead of silently re-buying", () => {
    const r = evaluatePurchase(mandate(), [{ productId: "p_milk", quantity: 1, unitCents: 450 }], ctx({ recentProductIds: ["p_milk"] }));
    expect(r.decision).toBe("REQUIRE_APPROVAL");
    expect(failedRules(r)).toEqual(["no_recent_duplicate"]);
  });

  it("escalates when no wallet is saved (falls back to buyer-approved checkout)", () => {
    const r = evaluatePurchase(mandate(), [{ productId: "p_milk", quantity: 1, unitCents: 450 }], ctx({ hasVaultedWallet: false }));
    expect(r.decision).toBe("REQUIRE_APPROVAL");
  });

  it("deny outranks escalate and reports only the deny reasons", () => {
    const r = evaluatePurchase(mandate(), [{ productId: "p_tv", quantity: 1, unitCents: 4000 }], ctx({ hasVaultedWallet: false }));
    expect(r.decision).toBe("DENY");
    expect(r.reasons).toEqual(['Category "Electronics"']);
  });
});
