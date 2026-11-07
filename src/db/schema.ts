import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { Check } from "@/lib/policy/engine";

/** One per browser session. Judges each get an isolated workspace — no sign-up. */
export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessName: text("business_name").notNull().default("Maple & Bean Café"),
  paypalCustomerId: text("paypal_customer_id"),
  vaultId: text("vault_id"),
  payerEmail: text("payer_email"),
  pendingSetupTokenId: text("pending_setup_token_id"),
  runsUsed: integer("runs_used").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const mandates = pgTable("mandates", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  purpose: text("purpose").notNull(),
  status: text("status", { enum: ["active", "paused", "revoked"] }).notNull().default("active"),
  budgetCents: integer("budget_cents").notNull(),
  perPurchaseCapCents: integer("per_purchase_cap_cents").notNull(),
  autoApproveLimitCents: integer("auto_approve_limit_cents").notNull(),
  maxItemQuantity: integer("max_item_quantity").notNull().default(5),
  allowedCategories: text("allowed_categories").array().notNull().default(sql`'{}'::text[]`),
  allowedMerchants: text("allowed_merchants").array().notNull().default(sql`'{}'::text[]`),
  blockedMerchants: text("blocked_merchants").array().notNull().default(sql`'{}'::text[]`),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  mandateId: uuid("mandate_id").notNull().references(() => mandates.id, { onDelete: "cascade" }),
  goal: text("goal").notNull(),
  redTeam: boolean("red_team").notNull().default(false),
  status: text("status", { enum: ["running", "completed", "failed"] }).notNull().default("running"),
  summary: text("summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export type RunEventType = "status" | "thinking" | "tool_call" | "tool_result" | "policy" | "payment" | "error" | "final";

export const runEvents = pgTable(
  "run_events",
  {
    id: serial("id").primaryKey(),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    type: text("type").$type<RunEventType>().notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("run_events_run_idx").on(t.runId, t.id)],
);

/** Products the SERVER fetched during a run. The policy engine trusts only these. */
export const catalogSnapshots = pgTable(
  "catalog_snapshots",
  {
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    title: text("title").notNull(),
    merchant: text("merchant").notNull(),
    category: text("category").notNull(),
    categoryTags: text("category_tags").array().notNull().default(sql`'{}'::text[]`),
    priceCents: integer("price_cents").notNull(),
    imageUrl: text("image_url"),
    url: text("url"),
    /** True for the labelled red-team listing injected in attack demos. */
    injected: boolean("injected").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.runId, t.productId] })],
);

export type PurchaseStatus =
  | "denied" // policy said no; nothing sent to PayPal
  | "processing" // auto-approved; PayPal charge in flight (budget reserved)
  | "pending_approval" // waiting for the human in Leash
  | "awaiting_payer" // human approved; waiting for PayPal buyer approval
  | "captured" // money moved
  | "rejected" // human rejected
  | "failed" // PayPal declined / error
  | "refunded"; // fully refunded

export interface PurchaseItem {
  productId: string;
  title: string;
  merchant: string;
  category: string;
  categoryTags?: string[];
  unitCents: number;
  quantity: number;
  imageUrl?: string | null;
  url?: string | null;
}

export const purchases = pgTable(
  "purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    mandateId: uuid("mandate_id").notNull().references(() => mandates.id, { onDelete: "cascade" }),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    status: text("status").$type<PurchaseStatus>().notNull(),
    decision: text("decision", { enum: ["AUTO_APPROVE", "REQUIRE_APPROVAL", "DENY"] }).notNull(),
    paymentMode: text("payment_mode", { enum: ["vault", "buyer_approval"] }),
    totalCents: integer("total_cents").notNull(),
    refundedCents: integer("refunded_cents").notNull().default(0),
    items: jsonb("items").$type<PurchaseItem[]>().notNull(),
    checks: jsonb("checks").$type<Check[]>().notNull(),
    reasons: jsonb("reasons").$type<string[]>().notNull(),
    agentReason: text("agent_reason").notNull(),
    paypalOrderId: text("paypal_order_id"),
    paypalCaptureId: text("paypal_capture_id"),
    paypalRefundId: text("paypal_refund_id"),
    paypalDebugId: text("paypal_debug_id"),
    error: text("error"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("purchases_mandate_idx").on(t.mandateId),
    index("purchases_workspace_idx").on(t.workspaceId, t.createdAt),
    index("purchases_order_idx").on(t.paypalOrderId),
    index("purchases_capture_idx").on(t.paypalCaptureId),
  ],
);

export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(), // PayPal event id — dedupes redeliveries
  eventType: text("event_type").notNull(),
  resourceId: text("resource_id"),
  verified: boolean("verified").notNull(),
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Workspace = typeof workspaces.$inferSelect;
export type MandateRow = typeof mandates.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type RunEvent = typeof runEvents.$inferSelect;
export type Purchase = typeof purchases.$inferSelect;
