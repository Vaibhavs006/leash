import "server-only";
import { PayPalClient } from "@/lib/paypal/client";
import { requireConfig } from "./env";

const g = globalThis as unknown as { __leashPayPal?: PayPalClient };

export function paypal(): PayPalClient {
  requireConfig("paypal");
  return (g.__leashPayPal ??= new PayPalClient({
    clientId: process.env.PAYPAL_CLIENT_ID!,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
    env: "sandbox",
  }));
}
