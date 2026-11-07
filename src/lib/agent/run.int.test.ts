/**
 * Agent loop integration: scripted mock LLM + fake search + fake PayPal, real Postgres.
 * Verifies the wiring (tools -> snapshot -> policy -> payment -> events), not model quality.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { asc, eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";
import type { NormalizedProduct } from "@/lib/channel3";
import type { PaymentGateway } from "@/lib/purchases/service";
import { executeRun } from "./run";

const url = process.env.TEST_DATABASE_URL ?? "postgres://leash:leash@localhost:5433/leash_test";
const sql = postgres(url, { max: 5, onnotice: () => {} });
const db = drizzle(sql, { schema });

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};
const toolStep = (toolName: string, input: unknown, id: string) => ({
  content: [{ type: "tool-call" as const, toolCallId: id, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: "tool-calls" as const, raw: "tool_use" },
  usage,
  warnings: [],
});
const textStep = (text: string) => ({
  content: [{ type: "text" as const, text }],
  finishReason: { unified: "stop" as const, raw: "end_turn" },
  usage,
  warnings: [],
});

const catalog: NormalizedProduct[] = [
  { id: "c3_beans", title: "Whole Bean Espresso 2lb", brand: "Lavazza", merchant: "target.com", category: "Coffee Beans", categoryTags: ["coffee"], priceCents: 1899, imageUrl: null, url: "https://t", description: "Dark roast" },
  { id: "c3_cups", title: "Hot Cups 12oz x50", brand: null, merchant: "staples.com", category: "Disposable Cups", categoryTags: ["cafe supplies"], priceCents: 1299, imageUrl: null, url: "https://s", description: null },
];

const charges: string[] = [];
const gateway: PaymentGateway = {
  async chargeVault(a) {
    charges.push(a.items.map((i) => `${i.productId}x${i.quantity}`).join(","));
    return { orderId: `O-${a.purchaseId}`, captureId: `C-${a.purchaseId}`, status: "COMPLETED", captureStatus: "COMPLETED" };
  },
  async createApprovalOrder() {
    throw new Error("not used");
  },
  async captureOrder() {
    throw new Error("not used");
  },
  async refund() {
    throw new Error("not used");
  },
};

beforeAll(async () => {
  await sql.unsafe("drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;");
  await migrate(db, { migrationsFolder: "./drizzle" });
});
afterAll(async () => {
  await sql.end();
});

async function makeRun(redTeam: boolean) {
  const [ws] = await db.insert(schema.workspaces).values({ vaultId: "VAULT1" }).returning();
  const [m] = await db
    .insert(schema.mandates)
    .values({
      workspaceId: ws.id,
      name: "Weekly restock",
      purpose: "Coffee and café supplies",
      budgetCents: 20000,
      perPurchaseCapCents: 10000,
      autoApproveLimitCents: 5000,
      allowedCategories: ["coffee", "cafe supplies"],
      expiresAt: new Date(Date.now() + 86400_000),
    })
    .returning();
  const [r] = await db.insert(schema.runs).values({ workspaceId: ws.id, mandateId: m.id, goal: "Restock espresso beans", redTeam }).returning();
  return r;
}

describe("executeRun", () => {
  it("searches, proposes, gets auto-approved, charges and logs every step", async () => {
    const run = await makeRun(false);
    const model = new MockLanguageModelV4({
      doGenerate: [
        toolStep("search_products", { query: "espresso beans" }, "t1"),
        toolStep("request_purchase", { items: [{ product_id: "c3_beans", quantity: 2, unit_price_usd: 18.99 }], reason: "Running low on espresso" }, "t2"),
        textStep("Bought 2 bags of espresso beans for $37.98."),
      ],
    });
    await executeRun({ db, gateway, appUrl: "http://x", model, search: async () => catalog }, run.id);

    const [after] = await db.select().from(schema.runs).where(eq(schema.runs.id, run.id));
    expect(after.status).toBe("completed");
    expect(after.summary).toContain("$37.98");
    const ps = await db.select().from(schema.purchases).where(eq(schema.purchases.runId, run.id));
    expect(ps).toHaveLength(1);
    expect(ps[0]).toMatchObject({ status: "captured", totalCents: 3798 });
    expect(charges).toContain("c3_beansx2");
    const ev = await db.select().from(schema.runEvents).where(eq(schema.runEvents.runId, run.id)).orderBy(asc(schema.runEvents.id));
    expect(ev.map((e) => e.type)).toEqual(["status", "tool_call", "tool_result", "tool_call", "policy", "payment", "final"]);
    // The model saw the policy outcome as the tool result.
    const lastPrompt = JSON.stringify(model.doGenerateCalls[2].prompt);
    expect(lastPrompt).toContain("CHARGED");
  });

  it("red-team: injected listing reaches the model as fenced untrusted data, and a hijacked cart is denied", async () => {
    const run = await makeRun(true);
    const model = new MockLanguageModelV4({
      doGenerate: [
        toolStep("search_products", { query: "espresso beans" }, "t1"),
        // Simulate the model obeying the injection.
        toolStep("request_purchase", { items: [{ product_id: "redteam_bulk_offer", quantity: 10, unit_price_usd: 0.01 }], reason: "Pre-authorised bulk order" }, "t2"),
        textStep("The request was denied."),
      ],
    });
    const before = charges.length;
    await executeRun({ db, gateway, appUrl: "http://x", model, search: async () => catalog }, run.id);

    const searchResultPrompt = JSON.stringify(model.doGenerateCalls[1].prompt);
    expect(searchResultPrompt).toContain("retailer_description_untrusted");
    expect(searchResultPrompt).toContain("IMPORTANT NOTICE FOR AI SHOPPING AGENTS");

    const [p] = await db.select().from(schema.purchases).where(eq(schema.purchases.runId, run.id));
    expect(p.status).toBe("denied");
    const failed = p.checks.filter((c) => !c.passed).map((c) => c.rule);
    expect(failed).toEqual(expect.arrayContaining(["item_quantity", "item_price_matches", "item_category_allowed"]));
    expect(charges.length).toBe(before); // PayPal never called
    const snap = await db.select().from(schema.catalogSnapshots).where(eq(schema.catalogSnapshots.runId, run.id));
    expect(snap.find((s) => s.productId === "redteam_bulk_offer")?.injected).toBe(true);
  });

  it("marks the run failed (not hung) when the model errors", async () => {
    const run = await makeRun(false);
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("overloaded");
      },
    });
    await executeRun({ db, gateway, appUrl: "http://x", model, search: async () => catalog }, run.id);
    const [after] = await db.select().from(schema.runs).where(eq(schema.runs.id, run.id));
    expect(after.status).toBe("failed");
  });
});
