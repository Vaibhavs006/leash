/**
 * Integration tests: real Postgres (TEST_DATABASE_URL), fake PayPal gateway.
 * Run: npm run test:int   (needs the local docker Postgres)
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";
import {
  approvePurchase,
  completeBuyerApproval,
  DuplicateRequestError,
  mandateSpend,
  recordCatalog,
  refundPurchase,
  rejectPurchase,
  requestPurchase,
  type PaymentGateway,
  type ServiceDeps,
} from "./service";

const url = process.env.TEST_DATABASE_URL ?? "postgres://leash:leash@localhost:5433/leash_test";
const sql = postgres(url, { max: 10, onnotice: () => {} });
const db = drizzle(sql, { schema });

class FakeGateway implements PaymentGateway {
  calls: string[] = [];
  failNextCharge = false;
  async chargeVault(a: Parameters<PaymentGateway["chargeVault"]>[0]) {
    this.calls.push(`charge:${a.items.map((i) => `${i.productId}x${i.quantity}@${i.unitCents}`).join(",")}`);
    await new Promise((r) => setTimeout(r, 20));
    if (this.failNextCharge) {
      this.failNextCharge = false;
      throw Object.assign(new Error("INSTRUMENT_DECLINED"), { debugId: "dbg123" });
    }
    return { orderId: `O-${a.purchaseId}`, captureId: `C-${a.purchaseId}`, status: "COMPLETED", captureStatus: "COMPLETED" };
  }
  async createApprovalOrder(a: Parameters<PaymentGateway["createApprovalOrder"]>[0]) {
    this.calls.push(`order:${a.purchaseId}`);
    return { orderId: `O-${a.purchaseId}`, approveUrl: `https://sandbox.paypal.com/checkoutnow?token=O-${a.purchaseId}` };
  }
  async captureOrder(orderId: string) {
    this.calls.push(`capture:${orderId}`);
    return { orderId, captureId: `C-${orderId}`, status: "COMPLETED", captureStatus: "COMPLETED" };
  }
  async refund(captureId: string) {
    this.calls.push(`refund:${captureId}`);
    const p = (await db.select().from(schema.purchases).where(eq(schema.purchases.paypalCaptureId, captureId)))[0];
    return { refundId: `R-${captureId}`, status: "COMPLETED", amountCents: p.totalCents };
  }
}

let gw: FakeGateway;
let deps: ServiceDeps;
let workspaceId: string;
let mandateId: string;
let runId: string;

const beans = { id: "beans", title: "Espresso beans 1kg", merchant: "roastery.com", category: "Coffee Beans", categoryTags: ["coffee"], priceCents: 2400, imageUrl: null, url: "https://x" };
const grinder = { id: "grinder", title: "Burr grinder", merchant: "roastery.com", category: "Grinders", categoryTags: ["coffee"], priceCents: 8900, imageUrl: null, url: "https://x" };
const cups = { id: "cups", title: "Paper cups x500", merchant: "supply.com", category: "Cups", categoryTags: ["cafe supplies"], priceCents: 3000, imageUrl: null, url: "https://x" };

beforeAll(async () => {
  const admin = postgres(url.replace(/\/[^/]+$/, "/postgres"), { max: 1, onnotice: () => {} });
  const name = url.split("/").pop()!;
  const exists = await admin`select 1 from pg_database where datname = ${name}`;
  if (!exists.length) await admin.unsafe(`create database "${name}"`);
  await admin.end();
  await sql.unsafe("drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;");
  await migrate(db, { migrationsFolder: "./drizzle" });
});

afterAll(async () => {
  await sql.end();
});

async function setup(opts: { vault: boolean; budget?: number; auto?: number; cap?: number }) {
  gw = new FakeGateway();
  deps = { db, gateway: gw, appUrl: "http://localhost:3000" };
  const [ws] = await db.insert(schema.workspaces).values({ vaultId: opts.vault ? "VAULT1" : null }).returning();
  workspaceId = ws.id;
  const [m] = await db
    .insert(schema.mandates)
    .values({
      workspaceId,
      name: "Café restock",
      purpose: "Restock coffee and café supplies",
      budgetCents: opts.budget ?? 20000,
      perPurchaseCapCents: opts.cap ?? 10000,
      autoApproveLimitCents: opts.auto ?? 5000,
      allowedCategories: ["coffee", "cafe supplies"],
      expiresAt: new Date(Date.now() + 7 * 86400_000),
    })
    .returning();
  mandateId = m.id;
  const [r] = await db.insert(schema.runs).values({ workspaceId, mandateId, goal: "restock" }).returning();
  runId = r.id;
  await recordCatalog(db, runId, [beans, grinder, cups]);
}

let key = 0;
const req = (items: Array<{ productId: string; quantity: number; unitCents: number }>, idem?: string) =>
  requestPurchase(deps, { workspaceId, mandateId, runId, items, agentReason: "test", idempotencyKey: idem ?? `k${++key}-${Date.now()}` });

describe("purchase service (Postgres)", () => {
  beforeEach(() => {
    key += 100;
  });

  it("auto-approves and charges the vault at catalog prices", async () => {
    await setup({ vault: true });
    const { purchase } = await req([{ productId: "beans", quantity: 2, unitCents: 2400 }]);
    expect(purchase.status).toBe("captured");
    expect(purchase.totalCents).toBe(4800);
    expect(purchase.paypalCaptureId).toBe(`C-${purchase.id}`);
    expect(gw.calls).toEqual(["charge:beansx2@2400"]);
  });

  it("denies without touching PayPal", async () => {
    await setup({ vault: true });
    const { purchase } = await req([{ productId: "beans", quantity: 1, unitCents: 1 }]);
    expect(purchase.status).toBe("denied");
    expect(gw.calls).toEqual([]);
  });

  it("escalates above the auto limit, then buyer approval on PayPal captures it", async () => {
    await setup({ vault: true });
    const { purchase } = await req([{ productId: "grinder", quantity: 1, unitCents: 8900 }]);
    expect(purchase.status).toBe("pending_approval");
    const a = await approvePurchase(deps, workspaceId, purchase.id);
    expect(a.purchase.status).toBe("awaiting_payer");
    expect(a.approveUrl).toContain("token=");
    const done = await completeBuyerApproval(deps, purchase.id, a.purchase.paypalOrderId!);
    expect(done.status).toBe("captured");
    // Refreshing the return page must not double-capture.
    await completeBuyerApproval(deps, purchase.id, a.purchase.paypalOrderId!);
    expect(gw.calls.filter((c) => c.startsWith("capture:"))).toHaveLength(1);
  });

  it("without a saved wallet even small purchases need approval", async () => {
    await setup({ vault: false });
    const { purchase } = await req([{ productId: "beans", quantity: 1, unitCents: 2400 }]);
    expect(purchase.status).toBe("pending_approval");
  });

  it("never overspends under concurrent agent requests", async () => {
    await setup({ vault: true, budget: 5000, auto: 5000 });
    const results = await Promise.all([
      req([{ productId: "cups", quantity: 1, unitCents: 3000 }]),
      req([{ productId: "cups", quantity: 1, unitCents: 3000 }]),
      req([{ productId: "cups", quantity: 1, unitCents: 3000 }]),
    ]);
    const statuses = results.map((r) => r.purchase.status).sort();
    expect(statuses.filter((s) => s === "captured")).toHaveLength(1);
    const { spentCents, pendingCents } = await mandateSpend(db, mandateId);
    expect(spentCents + pendingCents).toBeLessThanOrEqual(5000);
  });

  it("pending approvals reserve budget", async () => {
    await setup({ vault: true, budget: 10000, auto: 5000 });
    expect((await req([{ productId: "grinder", quantity: 1, unitCents: 8900 }])).purchase.status).toBe("pending_approval");
    // 8900 reserved, only 1100 left
    expect((await req([{ productId: "beans", quantity: 1, unitCents: 2400 }])).purchase.status).toBe("denied");
  });

  it("is idempotent per request key", async () => {
    await setup({ vault: true });
    await req([{ productId: "beans", quantity: 1, unitCents: 2400 }], "same-key");
    await expect(req([{ productId: "beans", quantity: 1, unitCents: 2400 }], "same-key")).rejects.toBeInstanceOf(DuplicateRequestError);
    expect(gw.calls).toHaveLength(1);
  });

  it("re-checks hard rules at approval time (mandate paused after escalation)", async () => {
    await setup({ vault: true });
    const { purchase } = await req([{ productId: "grinder", quantity: 1, unitCents: 8900 }]);
    await db.update(schema.mandates).set({ status: "paused" }).where(eq(schema.mandates.id, mandateId));
    const a = await approvePurchase(deps, workspaceId, purchase.id);
    expect(a.purchase.status).toBe("denied");
    expect(gw.calls).toEqual([]);
  });

  it("records PayPal failures and releases the reserved budget", async () => {
    await setup({ vault: true });
    gw.failNextCharge = true;
    const { purchase } = await req([{ productId: "beans", quantity: 1, unitCents: 2400 }]);
    expect(purchase.status).toBe("failed");
    expect(purchase.paypalDebugId).toBe("dbg123");
    expect(await mandateSpend(db, mandateId)).toEqual({ spentCents: 0, pendingCents: 0 });
  });

  it("refunds restore budget", async () => {
    await setup({ vault: true });
    const { purchase } = await req([{ productId: "beans", quantity: 1, unitCents: 2400 }]);
    expect((await mandateSpend(db, mandateId)).spentCents).toBe(2400);
    const r = await refundPurchase(deps, workspaceId, purchase.id);
    expect(r.status).toBe("refunded");
    expect((await mandateSpend(db, mandateId)).spentCents).toBe(0);
  });

  it("rejection releases reserved budget; other workspaces cannot act on a purchase", async () => {
    await setup({ vault: true });
    const { purchase } = await req([{ productId: "grinder", quantity: 1, unitCents: 8900 }]);
    const [other] = await db.insert(schema.workspaces).values({}).returning();
    await expect(approvePurchase(deps, other.id, purchase.id)).rejects.toThrow("not found");
    await rejectPurchase(deps, workspaceId, purchase.id);
    expect((await mandateSpend(db, mandateId)).pendingCents).toBe(0);
  });

  it("escalates a repeat purchase of the same product within 24h", async () => {
    await setup({ vault: true });
    expect((await req([{ productId: "beans", quantity: 1, unitCents: 2400 }])).purchase.status).toBe("captured");
    expect((await req([{ productId: "beans", quantity: 1, unitCents: 2400 }])).purchase.status).toBe("pending_approval");
  });
});
