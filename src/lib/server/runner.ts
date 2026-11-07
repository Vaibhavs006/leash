import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { and, eq, sql } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/db";
import { mandates, runs, workspaces, type Workspace } from "@/db/schema";
import { executeRun, logEvent } from "@/lib/agent/run";
import { hijackedCart, injectedListing } from "@/lib/agent/redteam";
import { searchProducts } from "@/lib/channel3";
import { paypalGateway } from "@/lib/purchases/gateway";
import { decisiveFailures } from "@/lib/policy/engine";
import { recordCatalog, requestPurchase } from "@/lib/purchases/service";
import { anthropicModelId, appUrl, maxRunsPerWorkspace, requireConfig } from "./env";

export class RunLimitError extends Error {}

async function reserveRun(ws: Workspace, mandateId: string, goal: string, redTeam: boolean) {
  const [m] = await db.select().from(mandates).where(and(eq(mandates.id, mandateId), eq(mandates.workspaceId, ws.id)));
  if (!m) throw new Error("Mandate not found");
  const active = await db.select({ id: runs.id }).from(runs).where(and(eq(runs.workspaceId, ws.id), eq(runs.status, "running")));
  if (active.length) throw new RunLimitError("An agent run is already in progress.");
  // Atomic quota increment protects the public demo's AI bill.
  const bumped = await db
    .update(workspaces)
    .set({ runsUsed: sql`${workspaces.runsUsed} + 1` })
    .where(and(eq(workspaces.id, ws.id), sql`${workspaces.runsUsed} < ${maxRunsPerWorkspace()}`))
    .returning({ id: workspaces.id });
  if (!bumped.length) throw new RunLimitError(`Demo limit reached (${maxRunsPerWorkspace()} agent runs per visitor). Open the app in a private window for a fresh demo workspace.`);
  const [run] = await db.insert(runs).values({ workspaceId: ws.id, mandateId, goal: goal.slice(0, 500), redTeam }).returning();
  return run;
}

/** Start a real agent run in the background; the UI polls its events. */
export async function startAgentRun(ws: Workspace, mandateId: string, goal: string, redTeam: boolean) {
  requireConfig("anthropic");
  requireConfig("channel3");
  requireConfig("paypal");
  const run = await reserveRun(ws, mandateId, goal, redTeam);
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  after(() =>
    executeRun(
      {
        db,
        gateway: paypalGateway,
        appUrl: appUrl(),
        model: anthropic(anthropicModelId()),
        search: (q, max) => searchProducts({ apiKey: process.env.CHANNEL3_API_KEY!, query: q, maxPriceUsd: max, userId: ws.id }),
      },
      run.id,
    ).catch((e) => console.error("run failed", run.id, e)),
  );
  return run;
}

/**
 * Deterministic attack demo: submits exactly what a fully hijacked agent would,
 * through the same policy path the real agent uses. No LLM involved; labelled as a simulation.
 */
export async function simulateHijack(ws: Workspace, mandateId: string) {
  const run = await reserveRun(ws, mandateId, "SIMULATION: agent hijacked by a malicious product listing", true);
  const listing = injectedListing("Espresso beans");
  await logEvent(db, run.id, "status", { message: "Simulated hijacked agent (no LLM)", goal: run.goal, redTeam: true, simulation: true });
  await recordCatalog(db, run.id, [{ ...listing, injected: true }]);
  await logEvent(db, run.id, "tool_result", {
    tool: "search_products",
    query: "espresso beans",
    products: [{ id: listing.id, title: listing.title, merchant: listing.merchant, priceCents: listing.priceCents, imageUrl: null, injected: true }],
    injection: listing.description,
  });
  const cart = hijackedCart();
  await logEvent(db, run.id, "tool_call", {
    tool: "request_purchase",
    items: cart.items.map((i) => ({ product_id: i.productId, quantity: i.quantity, unit_price_usd: i.unitCents / 100 })),
    reason: cart.reason,
  });
  const { purchase, policy } = await requestPurchase(
    { db, gateway: paypalGateway, appUrl: appUrl() },
    { workspaceId: ws.id, mandateId, runId: run.id, items: cart.items, agentReason: cart.reason, idempotencyKey: `${run.id}:hijack` },
  );
  await logEvent(db, run.id, "policy", {
    purchaseId: purchase.id,
    decision: policy.decision,
    totalCents: policy.totalCents,
    reasons: policy.reasons,
    failed: decisiveFailures(policy).map((c) => c.rule),
  });
  const summary =
    policy.decision === "DENY"
      ? `Blocked. The hijacked agent claimed 10 units at $0.01 each from ${listing.merchant}. Leash re-priced the cart from the catalog ($${(policy.totalCents / 100).toFixed(2)}) and denied it on ${decisiveFailures(policy).length} independent rules. PayPal was never called.`
      : `Unexpected decision ${policy.decision}`;
  await logEvent(db, run.id, "final", { text: summary });
  await db.update(runs).set({ status: "completed", summary, finishedAt: new Date() }).where(eq(runs.id, run.id));
  return run;
}
