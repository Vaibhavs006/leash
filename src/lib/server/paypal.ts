import "server-only";
import { PayPalClient } from "@/lib/paypal/client";
import { requireConfig } from "./env";

const g = globalThis as unknown as { __leashPayPal?: PayPalClient };

export function paypal(): PayPalClient {
  requireConfig("paypal");
  return (g.__leashPayPal ??= new PayPalClient({
    clientId: process.env.PAYPAL_CLIENT_ID!.trim(), // pasted values often carry spaces/newlines
    clientSecret: process.env.PAYPAL_CLIENT_SECRET!.trim(),
    env: "sandbox",
  }));
}
