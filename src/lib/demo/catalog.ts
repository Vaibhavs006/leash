/**
 * SIMULATED product catalog, used only when CHANNEL3_API_KEY is not configured.
 *
 * Every merchant uses the reserved `.example` TLD and every product id starts
 * with `sim_`, so simulated data can never be mistaken for real retailer data.
 * Same NormalizedProduct shape as the live Channel3 adapter.
 */
import type { NormalizedProduct } from "@/lib/channel3";

type Seed = [id: string, title: string, merchant: string, category: string, tags: string[], priceUsd: number, icon: string];

const SEEDS: Seed[] = [
  ["espresso_house_2lb", "House Blend Espresso Beans, Whole Bean, 2 lb", "beanery-supply.example", "Coffee Beans", ["coffee", "espresso", "beans", "whole bean"], 21.99, "☕"],
  ["espresso_dark_5lb", "Dark Roast Espresso Beans, Whole Bean, 5 lb", "roastworks.example", "Coffee Beans", ["coffee", "espresso", "beans", "dark roast"], 54.0, "☕"],
  ["espresso_decaf_2lb", "Swiss Water Decaf Espresso Beans, 2 lb", "beanery-supply.example", "Coffee Beans", ["coffee", "espresso", "decaf", "beans"], 24.5, "☕"],
  ["colombia_single_1lb", "Colombia Single-Origin Coffee Beans, 1 lb", "roastworks.example", "Coffee Beans", ["coffee", "beans", "single origin"], 15.75, "☕"],
  ["oatmilk_barista_6", "Barista Oat Milk, 32 oz, Pack of 6", "cafe-pantry.example", "Milk Alternatives", ["grocery", "beverages", "oat milk", "milk", "plant milk"], 23.94, "🥛"],
  ["almondmilk_barista_6", "Barista Almond Milk, 32 oz, Pack of 6", "cafe-pantry.example", "Milk Alternatives", ["grocery", "beverages", "almond milk", "milk"], 21.48, "🥛"],
  ["oatmilk_single", "Barista Oat Milk, 32 oz", "corner-grocer.example", "Milk Alternatives", ["grocery", "beverages", "oat milk", "milk"], 4.79, "🥛"],
  ["cups_12oz_50", "12 oz Paper Hot Cups, 50 count", "packit-supply.example", "Disposable Cups", ["cafe supplies", "disposable", "paper", "cups", "hot cups"], 9.99, "🥤"],
  ["cups_12oz_500", "12 oz Paper Hot Cups, 500 count (case)", "packit-supply.example", "Disposable Cups", ["cafe supplies", "disposable", "paper", "cups", "hot cups"], 58.0, "🥤"],
  ["lids_12oz_500", "Sip Lids for 10-20 oz Hot Cups, 500 count", "packit-supply.example", "Cup Lids", ["cafe supplies", "disposable", "lids"], 34.5, "🥤"],
  ["lids_12oz_100", "Sip Lids for 12 oz Hot Cups, 100 count", "cafe-pantry.example", "Cup Lids", ["cafe supplies", "disposable", "lids"], 8.25, "🥤"],
  ["sleeves_500", "Corrugated Cup Sleeves, 500 count", "packit-supply.example", "Cup Sleeves", ["cafe supplies", "disposable", "paper", "sleeves"], 27.0, "🥤"],
  ["napkins_1000", "Recycled Paper Napkins, 1000 count", "packit-supply.example", "Napkins", ["paper", "disposable", "napkins", "cafe supplies"], 16.4, "🧻"],
  ["stirrers_1000", "Wooden Coffee Stirrers, 1000 count", "cafe-pantry.example", "Stirrers", ["cafe supplies", "disposable", "stirrers"], 6.99, "🥄"],
  ["sugar_packets_1000", "Cane Sugar Packets, 1000 count", "cafe-pantry.example", "Sweeteners", ["grocery", "food", "sugar", "sweetener"], 18.5, "🍬"],
  ["vanilla_syrup", "Vanilla Coffee Syrup, 750 ml", "cafe-pantry.example", "Syrups", ["beverages", "coffee", "syrup", "vanilla"], 9.25, "🍯"],
  ["chai_concentrate", "Chai Tea Latte Concentrate, 32 oz", "corner-grocer.example", "Tea", ["tea", "beverages", "chai"], 6.49, "🍵"],
  ["green_tea_100", "Organic Green Tea Bags, 100 count", "corner-grocer.example", "Tea", ["tea", "beverages", "green tea"], 12.99, "🍵"],
  ["espresso_cleaner", "Espresso Machine Cleaning Tablets, 120 count", "barista-pro.example", "Cleaning Supplies", ["cleaning", "kitchen", "espresso", "cafe supplies"], 19.95, "🧽"],
  ["sanitizer_spray", "Food-Safe Surface Sanitizer, 1 gal", "barista-pro.example", "Cleaning Supplies", ["cleaning", "kitchen", "sanitizer"], 14.0, "🧴"],
  ["microfiber_24", "Microfiber Cleaning Cloths, 24 pack", "corner-grocer.example", "Cleaning Supplies", ["cleaning", "kitchen", "cloths"], 13.49, "🧽"],
  ["milk_pitcher", "Stainless Steel Milk Frothing Pitcher, 20 oz", "barista-pro.example", "Barista Tools", ["kitchen", "coffee", "espresso", "pitcher", "cafe supplies"], 17.99, "🫖"],
  ["tamper_58", "58 mm Espresso Tamper", "barista-pro.example", "Barista Tools", ["kitchen", "coffee", "espresso", "tamper"], 29.0, "🔧"],
  ["burr_grinder", "Commercial Conical Burr Coffee Grinder", "barista-pro.example", "Coffee Equipment", ["kitchen", "coffee", "grinder", "espresso", "equipment"], 89.0, "⚙️"],
  ["espresso_machine_1g", "Commercial Espresso Machine, 1 Group Head", "barista-pro.example", "Coffee Equipment", ["kitchen", "coffee", "espresso", "machine", "equipment"], 109.0, "☕"],
  ["espresso_machine_2g", "Commercial Espresso Machine, 2 Group Heads", "barista-pro.example", "Coffee Equipment", ["kitchen", "coffee", "espresso", "machine", "equipment"], 1495.0, "☕"],
  ["drip_brewer", "Commercial Drip Coffee Brewer, 12 cup", "barista-pro.example", "Coffee Equipment", ["kitchen", "coffee", "brewer", "drip", "equipment"], 74.5, "☕"],
  ["croissants_12", "Frozen Butter Croissants, 12 count", "corner-grocer.example", "Bakery", ["food", "grocery", "bakery", "pastry"], 19.0, "🥐"],
  ["muffins_6", "Blueberry Muffins, 6 count", "corner-grocer.example", "Bakery", ["food", "grocery", "bakery", "pastry"], 8.99, "🧁"],
  ["gaming_headset", "Wireless Gaming Headset", "gadget-outlet.example", "Electronics", ["electronics", "headset", "gaming"], 79.99, "🎧"],
  ["tablet_10", "10-inch Tablet, 64 GB", "gadget-outlet.example", "Electronics", ["electronics", "tablet"], 149.0, "📱"],
  ["espresso_bulk_shady", "Espresso Beans Wholesale, 10 lb", "bulk-deals-direct.example", "Coffee Beans", ["coffee", "espresso", "beans", "wholesale"], 39.0, "☕"],
];

const TILE_COLORS = ["#0f766e", "#7c3aed", "#b45309", "#0369a1", "#be123c", "#4d7c0f", "#475569"];

/** Font-independent placeholder tile: category initials on a colour derived from the category. */
function tileDataUri(category: string): string {
  const initials = category
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const color = TILE_COLORS[[...category].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TILE_COLORS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="${color}" fill-opacity="0.12"/><text x="32" y="40" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" fill="${color}" text-anchor="middle">${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const SIM_CATALOG: NormalizedProduct[] = SEEDS.map(([id, title, merchant, category, tags, price]) => ({
  id: `sim_${id}`,
  title,
  brand: null,
  merchant,
  category,
  categoryTags: [category.toLowerCase(), ...tags],
  priceCents: Math.round(price * 100),
  imageUrl: tileDataUri(category),
  url: `https://${merchant}/p/${id}`,
  description: `Simulated product for the Leash offline demo. ${title}.`,
}));

const STOP = new Set(["a", "an", "and", "the", "for", "of", "to", "our", "we", "re", "are", "out", "nearly", "some", "more", "new", "buy", "get", "order", "restock", "week", "weekly", "please", "with", "on", "in", "us", "need", "running", "low", "pack", "count"]);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/(\d)([a-z])/g, "$1 $2") // "12oz" -> "12 oz"
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

/**
 * Relevance: shared words, plus a bonus when the category's head noun (its last word,
 * e.g. "Cups" in "Disposable Cups") is the query's head noun, so "hot cups" prefers cups
 * over "Sip Lids for ... Hot Cups".
 */
export function relevance(query: string, title: string, category: string, tags: string[] = []): number {
  const q = tokenize(query);
  const hay = new Set(tokenize(`${title} ${tags.join(" ")}`));
  const overlap = q.reduce((s, w) => s + (hay.has(w) ? 1 : 0), 0);
  if (!overlap) return 0;
  const head = tokenize(category).at(-1);
  return overlap + (head && head === q.at(-1) ? 2 : 0);
}

/** Keyword search over the simulated catalog. Deterministic. */
export function simulatedSearch(query: string, maxPriceUsd?: number, limit = 8): NormalizedProduct[] {
  if (!tokenize(query).length) return [];
  return SIM_CATALOG.map((p) => ({ p, score: relevance(query, p.title, p.category, p.categoryTags) }))
    .filter((x) => x.score > 0 && (maxPriceUsd === undefined || x.p.priceCents <= maxPriceUsd * 100))
    .sort((a, b) => b.score - a.score || a.p.priceCents - b.p.priceCents)
    .slice(0, limit)
    .map((x) => x.p);
}
