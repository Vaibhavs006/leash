export const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export function timeAgo(iso: string | Date): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-US", { timeZone: "UTC" });
}

export const RULE_LABELS: Record<string, string> = {
  mandate_active: "Mandate active",
  mandate_not_expired: "Mandate not expired",
  cart_not_empty: "Cart not empty",
  no_duplicate_lines: "No split lines",
  item_from_catalog: "Item came from real catalog search",
  item_quantity: "Quantity within limit",
  item_price_matches: "Price matches catalog",
  item_category_allowed: "Category allowed",
  item_merchant_allowed: "Merchant allowed",
  per_purchase_cap: "Within per-purchase cap",
  within_budget: "Within remaining budget",
  auto_approve_limit: "Under auto-approve limit",
  no_recent_duplicate: "Not a repeat purchase (24h)",
  wallet_connected: "Saved wallet",
};

export function daysUntil(iso: string | Date): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400_000));
}

/** Map PayPal redirect query params (read on the server) to a one-time notice. */
export function noticeFromParams(q: Record<string, string | string[] | undefined>): { tone: "green" | "red" | "amber"; text: string } | null {
  const g = (k: string) => (Array.isArray(q[k]) ? q[k]?.[0] : q[k]) as string | undefined;
  const err = g("error")?.slice(0, 200);
  const sim = g("sim") === "1";
  if (g("wallet") === "connected")
    return {
      tone: "green",
      text: sim
        ? "Simulated wallet saved (offline demo, no PayPal). The agent can now pay for in-policy purchases automatically."
        : "PayPal wallet saved. The agent can now pay for in-policy purchases automatically.",
    };
  if (g("wallet") === "error") return { tone: "red", text: `Could not save PayPal wallet: ${err ?? "unknown error"}` };
  if (g("wallet") === "cancelled") return { tone: "amber", text: "Wallet connection cancelled." };
  if (g("paid") === "1")
    return { tone: "green", text: sim ? "Approved and captured (simulated payment, no money moved). The ledger is updated." : "Approved on PayPal and captured. The ledger is updated." };
  if (g("paid") === "0") return { tone: "red", text: `Payment not completed: ${err ?? "PayPal did not capture the order"}` };
  if (g("cancelled") === "1") return { tone: "amber", text: "Approval cancelled. The purchase is back in your approval queue." };
  return null;
}
