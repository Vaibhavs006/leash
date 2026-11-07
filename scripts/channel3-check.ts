/**
 * Verifies the live Channel3 response shape against Leash's parser.
 *   npm run check:channel3 -- "espresso beans"
 */
import { config } from "dotenv";
import { searchProducts } from "../src/lib/channel3";

config({ path: ".env.local" });

async function main() {
  const key = process.env.CHANNEL3_API_KEY;
  if (!key) throw new Error("Set CHANNEL3_API_KEY in .env.local");
  const query = process.argv[2] ?? "whole bean espresso coffee";
  const res = await fetch("https://api.trychannel3.com/v1/search", {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit: 3 }),
  });
  const raw = await res.json();
  console.log(`HTTP ${res.status}. First raw offer:`);
  console.log(JSON.stringify(raw?.products?.[0]?.offers?.[0] ?? raw, null, 2).slice(0, 800));
  console.log("First raw category:", JSON.stringify(raw?.products?.[0]?.category));
  const products = await searchProducts({ apiKey: key, query, limit: 5 });
  console.log(`\nParsed ${products.length} purchasable products:`);
  for (const p of products) console.log(`  ${p.id}  $${(p.priceCents / 100).toFixed(2)}  ${p.merchant}  [${p.category}]  ${p.title.slice(0, 60)}`);
  if (!products.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
