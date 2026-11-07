import { z } from "zod";

const list = z
  .array(z.string().trim().toLowerCase().min(1).max(60))
  .max(30)
  .transform((a) => [...new Set(a)]);

const cents = z.number().int().min(0).max(1_000_000);

export const MandateInput = z
  .object({
    name: z.string().trim().min(2).max(80),
    purpose: z.string().trim().min(5).max(500),
    budgetCents: cents.min(100),
    perPurchaseCapCents: cents.min(100),
    autoApproveLimitCents: cents,
    maxItemQuantity: z.number().int().min(1).max(50),
    allowedCategories: list,
    allowedMerchants: list,
    blockedMerchants: list,
    expiresInDays: z.number().int().min(1).max(90),
  })
  .refine((m) => m.autoApproveLimitCents <= m.perPurchaseCapCents, { message: "Auto-approve limit must not exceed the per-purchase cap", path: ["autoApproveLimitCents"] })
  .refine((m) => m.perPurchaseCapCents <= m.budgetCents, { message: "Per-purchase cap must not exceed the budget", path: ["perPurchaseCapCents"] });
