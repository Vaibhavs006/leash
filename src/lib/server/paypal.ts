import "server-only";
import { PayPalClient } from "@/lib/paypal/client";
import { env } from "./env";

const g = globalThis as unknown as { __leashPayPal?: PayPalClient };

export function paypal(): PayPalClient {
  const e = env();
  return (g.__leashPayPal ??= new PayPalClient({
    clientId: e.PAYPAL_CLIENT_ID,
    clientSecret: e.PAYPAL_CLIENT_SECRET,
    env: "sandbox",
  }));
}
