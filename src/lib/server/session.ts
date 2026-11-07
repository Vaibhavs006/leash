import "server-only";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { mandates, workspaces, type Workspace } from "@/db/schema";

export const WORKSPACE_COOKIE = "leash_ws";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Default mandate every new workspace starts with — a realistic café restock. */
export function defaultMandate(workspaceId: string) {
  return {
    workspaceId,
    name: "Weekly café restock",
    purpose: "Keep the café stocked with coffee beans, milk alternatives, cups, lids and cleaning supplies.",
    budgetCents: 25000,
    perPurchaseCapCents: 12000,
    autoApproveLimitCents: 4000,
    maxItemQuantity: 6,
    allowedCategories: ["coffee", "tea", "food", "grocery", "beverages", "cafe supplies", "kitchen", "cleaning", "paper", "disposable"],
    allowedMerchants: [] as string[],
    blockedMerchants: ["bulk-deals-direct.shop"],
    expiresAt: new Date(Date.now() + 7 * 86400_000),
  };
}

/**
 * The proxy guarantees a random UUID cookie. The workspace row is created on first use.
 * Possession of the (httpOnly, unguessable) cookie is the only credential — fine for a sandbox demo.
 */
export async function currentWorkspace(): Promise<Workspace> {
  const id = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  if (!id || !UUID.test(id)) throw new Error("No workspace session");
  const [existing] = await db.select().from(workspaces).where(eq(workspaces.id, id));
  if (existing) return existing;
  const [created] = await db.insert(workspaces).values({ id }).onConflictDoNothing().returning();
  if (!created) return (await db.select().from(workspaces).where(eq(workspaces.id, id)))[0];
  await db.insert(mandates).values(defaultMandate(id));
  return created;
}
