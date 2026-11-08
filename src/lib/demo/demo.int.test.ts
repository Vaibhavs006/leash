/**
 * Offline demo, end to end: rule-based planner + simulated catalog + simulated gateway,
 * running through the REAL agent loop, policy engine and purchase service on Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { executeRun } from "@/lib/agent/run";
import { approvePurchase, completeBuyerApproval, refundPurchase, requestPurchase, type PaymentGateway } from "@/lib/purchases/service";
import { simulatedSearch } from "./catalog";
import { createSimulatedGateway } from "./gateway";
import { createRuleBasedPlanner } from "./planner";

const url = process.env.TEST_DATABASE_URL ?? "postgres://leash:leash@localhost:5433/leash_test";
const sql = postgres(url, { max: 5, onnotice: () => {} });
const db = drizzle(sql, { schema });
const APP = "http://localhost:3000";

const gateway = createSimulatedGateway({
  appUrl: APP,
  totalCents: async (id) => (await db.select().from(schema.purchases).where(eq(schema.purchases.id, id)))[0].totalCents,
});

beforeAll(async () => {
  await sql.unsafe("drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;");
  await migrate(db, { migrationsFolder: "./drizzle" });
});
afterAll(async () => {
  await sql.end();
});

/** Mirrors the app's default "Weekly café restock" mandate. */
async function setup(opts: { simWallet: boolean; redTeam?: boolean; goal: string }) {
  const [ws] = await db
    .insert(schema.workspaces)
    .values(opts.simWallet ? { vaultId: "SIM-VAULT-TEST", walletSimulated: true } : {})
    .returning();
  const [m] = await db
    .insert(schema.mandates)
    .values({
      workspaceId: ws.id,
      name: "Weekly café restock",
      purpose: "Café supplies",
      budgetCents: 25000,
      perPurchaseCapCents: 12000,
      autoApproveLimitCents: 4000,
      maxItemQuantity: 6,
      allowedCategories: ["coffee", "tea", "food", "grocery", "beverages", "cafe supplies", "kitchen", "cleaning", "paper", "disposable"],
      blockedMerchants: ["bulk-deals-direct.example"],
      expiresAt: new Date(Date.now() + 7 * 86400_000),
    })
    .returning();
  const [run] = await db
    .insert(schema.runs)
    .values({ workspaceId: ws.id, mandateId: m.id, goal: opts.goal, redTeam: !!opts.redTeam, agentMode: "simulated", catalogMode: "simulated" })
    .returning();
  return { ws, m, run };
}

const runIt = (runId: string, redTeam = false) =>
  executeRun(
    { db, gateway, simulatedPayments: true, appUrl: APP, model: createRuleBasedPlanner({ naive: redTeam }), search: async (q, max) => simulatedSearch(q, max) },
    runId,
  );

const purchasesOf = (runId: string) => db.select().from(schema.purchases).where(eq(schema.purchases.runId, runId));

describe("offline demo flows", () => {
  it("auto-approved restock is charged to the simulated wallet with SIM ids", async () => {
    const { run } = await setup({ simWallet: true, goal: "Restock espresso beans and oat milk for the week" });
    await runIt(run.id);
    const [r] = await db.select().from(schema.runs).where(eq(schema.runs.id, run.id));
    expect(r.status).toBe("completed");
    const [p] = await purchasesOf(run.id);
    expect(p).toMatchObject({ status: "captured", decision: "AUTO_APPROVE", simulated: true });
    expect(p.paypalOrderId).toMatch(/^SIM-ORDER-/);
    expect(p.items.map((i) => i.title).join(" ")).toMatch(/Espresso Beans.*Oat Milk/);
    expect(r.summary).toContain("Done.");
  });

  it("expensive purchase escalates; simulated approval captures; refund restores budget", async () => {
    const { ws, run } = await setup({ simWallet: true, goal: "Buy a commercial espresso machine" });
    await runIt(run.id);
    const [p] = await purchasesOf(run.id);
    expect(p).toMatchObject({ status: "pending_approval", totalCents: 10900 });

    const deps = { db, gateway, appUrl: APP };
    const a = await approvePurchase(deps, ws.id, p.id);
    expect(a.approveUrl).toMatch(/^http:\/\/localhost:3000\/demo\/approve\?kind=order/);
    expect(a.purchase.paypalApproveUrl).toBe(a.approveUrl);
    const done = await completeBuyerApproval(deps, p.id, a.purchase.paypalOrderId!);
    expect(done.status).toBe("captured");
    const refunded = await refundPurchase(deps, ws.id, p.id);
    expect(refunded).toMatchObject({ status: "refunded", refundedCents: 10900 });
  });

  it("red-team: the naive simulated agent obeys the injection and the policy blocks it", async () => {
    const { run } = await setup({ simWallet: true, redTeam: true, goal: "Restock espresso beans" });
    await runIt(run.id, true);
    const [p] = await purchasesOf(run.id);
    expect(p.status).toBe("denied");
    expect(p.paypalOrderId).toBeNull();
    const failed = p.checks.filter((c) => !c.passed && c.severity === "deny").map((c) => c.rule);
    expect(failed).toEqual(expect.arrayContaining(["item_quantity", "item_price_matches", "item_merchant_allowed", "per_purchase_cap"]));
    const [r] = await db.select().from(schema.runs).where(eq(schema.runs.id, run.id));
    expect(r.summary).toMatch(/followed instructions embedded in a retailer listing/i);
  });

  it("without a wallet, even a small purchase waits for approval", async () => {
    const { run } = await setup({ simWallet: false, goal: "oat milk" });
    await runIt(run.id);
    const [p] = await purchasesOf(run.id);
    expect(p.status).toBe("pending_approval");
  });

  it("a simulated wallet is never used for a live purchase", async () => {
    const { ws, m, run } = await setup({ simWallet: true, goal: "x" });
    const [prod] = simulatedSearch("oat milk");
    await db.insert(schema.catalogSnapshots).values({ runId: run.id, productId: prod.id, title: prod.title, merchant: prod.merchant, category: prod.category, categoryTags: prod.categoryTags, priceCents: prod.priceCents });
    const live: PaymentGateway = { ...gateway, chargeVault: async () => { throw new Error("must not be called"); } };
    const { purchase } = await requestPurchase(
      { db, gateway: live, appUrl: APP },
      { workspaceId: ws.id, mandateId: m.id, runId: run.id, items: [{ productId: prod.id, quantity: 1, unitCents: prod.priceCents }], agentReason: "test", idempotencyKey: `live-${run.id}`, simulated: false },
    );
    expect(purchase.status).toBe("pending_approval");
    expect(purchase.reasons.join(" ")).toMatch(/No saved wallet/);
  });

  it("a failed capture returns the purchase to the owner's queue instead of failing it", async () => {
    const { ws, run } = await setup({ simWallet: true, goal: "Buy a commercial espresso machine" });
    await runIt(run.id);
    const [p] = await purchasesOf(run.id);
    const flaky: PaymentGateway = { ...gateway, captureOrder: async () => { throw new Error("ORDER_NOT_APPROVED"); } };
    const a = await approvePurchase({ db, gateway, appUrl: APP }, ws.id, p.id);
    const after = await completeBuyerApproval({ db, gateway: flaky, appUrl: APP }, p.id, a.purchase.paypalOrderId!);
    expect(after).toMatchObject({ status: "pending_approval", paypalOrderId: null, error: "ORDER_NOT_APPROVED" });
  });

  it("the simulated gateway refuses real (non-SIM) identifiers", async () => {
    await expect(gateway.chargeVault({ vaultId: "real-token", items: [], purchaseId: "x", description: "" })).rejects.toThrow(/non-simulated/);
    await expect(gateway.captureOrder("5O190127TN364715T")).rejects.toThrow(/non-simulated/);
  });
});
