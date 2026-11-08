import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { and, count, eq, lt, sql } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/db";
import { mandates, purchases, runs, workspaces, type Workspace } from "@/db/schema";
import { executeRun, logEvent } from "@/lib/agent/run";
import { hijackedCart, injectedListing } from "@/lib/agent/redteam";
import { searchProducts } from "@/lib/channel3";
import { simulatedSearch } from "@/lib/demo/catalog";
import { newSimulatedVaultId, SIM_PAYER_EMAIL } from "@/lib/demo/gateway";
import { createRuleBasedPlanner } from "@/lib/demo/planner";
import { decisiveFailures } from "@/lib/policy/engine";
import { recordCatalog, requestPurchase } from "@/lib/purchases/service";
import { anthropicModelId, appUrl, maxRunsPerWorkspace } from "./env";
import { modes, requireMode } from "./modes";
import { currentPayments, gatewayFor } from "./payments";

export class RunLimitError extends Error {}

/** Agent runs are capped at 12 model steps / 4 minutes; anything older than this was interrupted. */
const STALE_RUN_MS = 5 * 60 * 1000;
const MAX_RUNS_STORED = 100;

async function reserveRun(
  ws: Workspace,
  mandateId: string,
  goal: string,
  opts: { redTeam: boolean; agentMode: "live" | "simulated"; catalogMode: "live" | "simulated" },
) {
  const [m] = await db.select().from(mandates).where(and(eq(mandates.id, mandateId), eq(mandates.workspaceId, ws.id)));
  if (!m) throw new Error("Mandate not found");
  // A run interrupted by a redeploy/crash would stay "running" forever; expire it.
  await db
    .update(runs)
    .set({ status: "failed", summary: "Interrupted (server restarted). Please run again.", finishedAt: new Date() })
    .where(and(eq(runs.workspaceId, ws.id), eq(runs.status, "running"), lt(runs.createdAt, new Date(Date.now() - STALE_RUN_MS))));
  const active = await db.select({ id: runs.id }).from(runs).where(and(eq(runs.workspaceId, ws.id), eq(runs.status, "running")));
  if (active.length) throw new RunLimitError("An agent run is already in progress.");
  // Database-spam guard for free (simulated) runs. Reset demo clears runs.
  const [{ n }] = await db.select({ n: count() }).from(runs).where(eq(runs.workspaceId, ws.id));
  if (n >= MAX_RUNS_STORED) throw new RunLimitError(`This workspace has ${n} runs. Use "Reset demo" to start fresh.`);
  // Atomic quota on live LLM runs protects the public demo's AI bill. Simulated runs are free.
  if (opts.agentMode === "live") {
    const bumped = await db
      .update(workspaces)
      .set({ runsUsed: sql`${workspaces.runsUsed} + 1` })
      .where(and(eq(workspaces.id, ws.id), sql`${workspaces.runsUsed} < ${maxRunsPerWorkspace()}`))
      .returning({ id: workspaces.id });
    if (!bumped.length) throw new RunLimitError(`Demo limit reached (${maxRunsPerWorkspace()} agent runs per visitor). Open the app in a private window for a fresh demo workspace.`);
  }
  const [run] = await db
    .insert(runs)
    .values({ workspaceId: ws.id, mandateId, goal: goal.slice(0, 500), redTeam: opts.redTeam, agentMode: opts.agentMode, catalogMode: opts.catalogMode })
    .returning();
  return run;
}

/**
 * Start an agent run in the background; the UI polls its events. Each integration is
 * live when configured, otherwise the labelled offline simulator (unless DEMO_MODE=off).
 */
export async function startAgentRun(ws: Workspace, mandateId: string, goal: string, redTeam: boolean) {
  const agentMode = requireMode("agent");
  const catalogMode = requireMode("catalog");
  const payments = currentPayments();
  const run = await reserveRun(ws, mandateId, goal, { redTeam, agentMode, catalogMode });

  const model =
    agentMode === "live" ? createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(anthropicModelId()) : createRuleBasedPlanner({ naive: redTeam });
  const search =
    catalogMode === "live"
      ? (q: string, max?: number) => searchProducts({ apiKey: process.env.CHANNEL3_API_KEY!, query: q, maxPriceUsd: max, userId: ws.id })
      : async (q: string, max?: number) => simulatedSearch(q, max);

  after(() =>
    executeRun({ db, gateway: payments.gateway, simulatedPayments: payments.simulated, appUrl: appUrl(), model, search }, run.id).catch((e) =>
      console.error("run failed", run.id, e),
    ),
  );
  return run;
}

/**
 * Deterministic attack demo: submits exactly what a fully hijacked agent would,
 * through the same policy path the real agent uses. No LLM, no keys needed; labelled as a simulation.
 */
export async function simulateHijack(ws: Workspace, mandateId: string) {
  const run = await reserveRun(ws, mandateId, "SIMULATION: agent hijacked by a malicious product listing", {
    redTeam: true,
    agentMode: "simulated",
    catalogMode: "simulated",
  });
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
  // The hijacked cart is always denied (price mismatch at minimum), so no gateway is ever called.
  // Record it against whichever payment mode is current, defaulting to simulated.
  const simulated = modes().payments !== "live";
  const { purchase, policy } = await requestPurchase(
    { db, gateway: gatewayFor(simulated), appUrl: appUrl() },
    { workspaceId: ws.id, mandateId, runId: run.id, items: cart.items, agentReason: cart.reason, idempotencyKey: `${run.id}:hijack`, simulated },
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
      ? `Blocked. The hijacked agent claimed 10 units at $0.01 each from ${listing.merchant}. Leash re-priced the cart from the catalog ($${(policy.totalCents / 100).toFixed(2)}) and denied it on ${decisiveFailures(policy).length} independent rules. No payment was attempted.`
      : `Unexpected decision ${policy.decision}`;
  await logEvent(db, run.id, "final", { text: summary });
  await db.update(runs).set({ status: "completed", summary, finishedAt: new Date() }).where(eq(runs.id, run.id));
  return run;
}

/** Goals for the sample history, in order. The last one is left waiting for approval. */
const SAMPLE_GOALS = [
  "Restock espresso beans and oat milk for the week",
  "We're nearly out of 12oz hot cups and lids",
  "Buy a gaming headset for the back office",
  "Buy a commercial espresso machine",
];

/**
 * Offline demo only: fills an empty workspace with realistic history by running the REAL
 * simulated agent, policy engine and payment simulator (no rows are fabricated).
 * Produces: two auto-paid restocks, one policy denial, one blocked hijack, one pending approval.
 */
export async function loadSampleHistory(ws: Workspace) {
  if (modes().payments !== "simulated") throw new Error("Sample history is only available in offline demo mode (no PayPal keys).");
  const [existingPurchase] = await db.select({ id: purchases.id }).from(purchases).where(eq(purchases.workspaceId, ws.id)).limit(1);
  const [existingRun] = await db.select({ id: runs.id }).from(runs).where(eq(runs.workspaceId, ws.id)).limit(1);
  if (existingPurchase || existingRun) throw new Error('Sample history needs an empty workspace. Use "Reset demo" first.');
  const [m] = await db.select().from(mandates).where(and(eq(mandates.workspaceId, ws.id), eq(mandates.status, "active"))).limit(1);
  if (!m) throw new Error("No active mandate. Use Reset demo to restore the default one.");

  if (!ws.vaultId || !ws.walletSimulated) {
    await db.update(workspaces).set({ vaultId: newSimulatedVaultId(), walletSimulated: true, payerEmail: SIM_PAYER_EMAIL }).where(eq(workspaces.id, ws.id));
  }
  const payments = currentPayments();
  const deps = { db, gateway: payments.gateway, simulatedPayments: true, appUrl: appUrl(), search: async (q: string, max?: number) => simulatedSearch(q, max) };

  for (const goal of SAMPLE_GOALS.slice(0, 3)) {
    const run = await reserveRun(ws, m.id, goal, { redTeam: false, agentMode: "simulated", catalogMode: "simulated" });
    await executeRun({ ...deps, model: createRuleBasedPlanner() }, run.id);
  }
  await simulateHijack(ws, m.id);
  const last = await reserveRun(ws, m.id, SAMPLE_GOALS[3], { redTeam: false, agentMode: "simulated", catalogMode: "simulated" });
  await executeRun({ ...deps, model: createRuleBasedPlanner() }, last.id);
  return { runs: SAMPLE_GOALS.length + 1 };
}
