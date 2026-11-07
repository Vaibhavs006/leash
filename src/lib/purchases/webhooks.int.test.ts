import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { handleWebhookEvent } from "./webhooks";

const url = process.env.TEST_DATABASE_URL ?? "postgres://leash:leash@localhost:5433/leash_test";
const sql = postgres(url, { max: 5, onnotice: () => {} });
const db = drizzle(sql, { schema });

let purchaseId: string;
let workspaceId: string;

beforeAll(async () => {
  await sql.unsafe("drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade;");
  await migrate(db, { migrationsFolder: "./drizzle" });
  const [ws] = await db.insert(schema.workspaces).values({ vaultId: "VT1" }).returning();
  workspaceId = ws.id;
  const [m] = await db
    .insert(schema.mandates)
    .values({ workspaceId: ws.id, name: "m", purpose: "p", budgetCents: 10000, perPurchaseCapCents: 5000, autoApproveLimitCents: 2000, expiresAt: new Date(Date.now() + 86400_000) })
    .returning();
  const [p] = await db
    .insert(schema.purchases)
    .values({
      workspaceId: ws.id,
      mandateId: m.id,
      status: "awaiting_payer",
      decision: "REQUIRE_APPROVAL",
      totalCents: 3000,
      items: [],
      checks: [],
      reasons: [],
      agentReason: "x",
      paypalOrderId: "ORDER1",
      idempotencyKey: "wh-test",
    })
    .returning();
  purchaseId = p.id;
});
afterAll(async () => {
  await sql.end();
});

const get = async () => (await db.select().from(schema.purchases).where(eq(schema.purchases.id, purchaseId)))[0];

describe("handleWebhookEvent", () => {
  it("ignores unverified events but records them", async () => {
    const out = await handleWebhookEvent(db, { id: "EV0", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAP1" } }, false);
    expect(out).toBe("ignored");
    expect((await get()).status).toBe("awaiting_payer");
  });

  it("marks a purchase captured by order id, and dedupes redelivery", async () => {
    const ev = { id: "EV1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAP1", supplementary_data: { related_ids: { order_id: "ORDER1" } } } };
    expect(await handleWebhookEvent(db, ev, true)).toBe("updated");
    expect(await handleWebhookEvent(db, ev, true)).toBe("duplicate");
    expect(await get()).toMatchObject({ status: "captured", paypalCaptureId: "CAP1" });
  });

  it("applies a partial then full refund from the capture link", async () => {
    const refund = (id: string, value: string) => ({
      id,
      event_type: "PAYMENT.CAPTURE.REFUNDED",
      resource: { id: `R-${id}`, amount: { value }, links: [{ rel: "up", href: "https://api-m.sandbox.paypal.com/v2/payments/captures/CAP1" }] },
    });
    await handleWebhookEvent(db, refund("EV2", "10.00"), true);
    expect(await get()).toMatchObject({ status: "captured", refundedCents: 1000 });
    await handleWebhookEvent(db, refund("EV3", "30.00"), true);
    expect(await get()).toMatchObject({ status: "refunded", refundedCents: 3000 });
  });

  it("clears a revoked vault token", async () => {
    expect(await handleWebhookEvent(db, { id: "EV4", event_type: "VAULT.PAYMENT-TOKEN.DELETED", resource: { id: "VT1" } }, true)).toBe("updated");
    const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    expect(ws.vaultId).toBeNull();
  });
});
