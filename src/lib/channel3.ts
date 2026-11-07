/**
 * Channel3 product search (https://api.trychannel3.com/v1/search).
 *
 * We normalise each product to the single best in-stock USD offer: that offer's
 * domain becomes the "merchant" the policy engine checks, and its price is the
 * only price Leash will ever charge.
 */
import { z } from "zod";

const Price = z
  .object({
    price: z.number().optional(),
    amount: z.number().optional(),
    currency: z.string().default("USD"),
  })
  .passthrough();

const Offer = z
  .object({
    url: z.string(),
    domain: z.string(),
    price: Price,
    availability: z.string().nullish(),
  })
  .passthrough();

const Product = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string().nullish(),
    brands: z.array(z.object({ name: z.string() }).passthrough()).nullish(),
    images: z
      .array(z.object({ url: z.string(), cleaned_url: z.string().nullish(), is_main_image: z.boolean().nullish() }).passthrough())
      .nullish(),
    category: z
      .object({ slug: z.string().nullish(), title: z.string().nullish(), path: z.union([z.array(z.string()), z.string()]).nullish() })
      .passthrough()
      .nullish(),
    key_features: z.array(z.string()).nullish(),
    offers: z.array(Offer).default([]),
  })
  .passthrough();

const SearchResponse = z.object({ products: z.array(Product) }).passthrough();

export interface NormalizedProduct {
  id: string;
  title: string;
  brand: string | null;
  merchant: string; // retailer domain
  category: string;
  categoryTags: string[];
  priceCents: number;
  imageUrl: string | null;
  url: string;
  /** Untrusted retailer text — shown to the agent only as quoted data. */
  description: string | null;
}

export class Channel3Error extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "Channel3Error";
  }
}

function categoryTags(cat: z.infer<typeof Product>["category"]): { label: string; tags: string[] } {
  if (!cat) return { label: "uncategorized", tags: [] };
  const path = Array.isArray(cat.path) ? cat.path : typeof cat.path === "string" ? cat.path.split(/\s*[>/]\s*/) : [];
  const tags = [cat.slug, cat.title, ...path]
    .filter((x): x is string => !!x)
    .flatMap((x) => [x, x.replace(/-/g, " ")])
    .map((x) => x.trim().toLowerCase());
  return { label: cat.title ?? cat.slug ?? path.at(-1) ?? "uncategorized", tags: [...new Set(tags)] };
}

export function normalizeProduct(p: z.infer<typeof Product>): NormalizedProduct | null {
  const offers = p.offers
    .map((o) => ({ o, amount: o.price.price ?? o.price.amount }))
    .filter(
      (x): x is { o: z.infer<typeof Offer>; amount: number } =>
        typeof x.amount === "number" &&
        x.amount > 0 &&
        x.o.price.currency.toUpperCase() === "USD" &&
        (x.o.availability ?? "InStock") === "InStock",
    )
    .sort((a, b) => a.amount - b.amount);
  const best = offers[0];
  if (!best) return null;
  const img = p.images?.find((i) => i.is_main_image) ?? p.images?.[0];
  const { label, tags } = categoryTags(p.category);
  return {
    id: p.id,
    title: p.title,
    brand: p.brands?.[0]?.name ?? null,
    merchant: best.o.domain.toLowerCase().replace(/^www\./, ""),
    category: label,
    categoryTags: tags,
    priceCents: Math.round(best.amount * 100),
    imageUrl: img?.cleaned_url ?? img?.url ?? null,
    url: best.o.url,
    description: p.description ? p.description.slice(0, 600) : null,
  };
}

export async function searchProducts(opts: {
  apiKey: string;
  query: string;
  maxPriceUsd?: number;
  limit?: number;
  userId?: string;
}): Promise<NormalizedProduct[]> {
  const res = await fetch("https://api.trychannel3.com/v1/search", {
    method: "POST",
    headers: {
      "x-api-key": opts.apiKey,
      "Content-Type": "application/json",
      ...(opts.userId ? { "x-user-id": opts.userId } : {}),
    },
    body: JSON.stringify({
      query: opts.query,
      limit: Math.min(opts.limit ?? 8, 20),
      filters: {
        availability: ["InStock"],
        ...(opts.maxPriceUsd ? { price: { max_price: opts.maxPriceUsd } } : {}),
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Channel3Error(`Channel3 search failed (${res.status}): ${text.slice(0, 300)}`, res.status);
  }
  const parsed = SearchResponse.parse(await res.json());
  return parsed.products.map(normalizeProduct).filter((p): p is NormalizedProduct => p !== null);
}
