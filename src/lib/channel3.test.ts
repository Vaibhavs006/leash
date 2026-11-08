import { describe, expect, it } from "vitest";
import { normalizeProduct, parseProducts } from "./channel3";

const base = {
  id: "abc",
  title: "Espresso Beans 1kg",
  description: "Rich and chocolatey",
  brands: [{ name: "Roastery" }],
  images: [{ url: "https://img/1.jpg", cleaned_url: "https://img/1c.jpg", is_main_image: true }],
  category: { slug: "coffee-beans", title: "Coffee Beans", path: ["Food", "Beverages", "Coffee"] },
};

describe("normalizeProduct", () => {
  it("picks the cheapest in-stock USD offer and uses its domain as merchant", () => {
    const p = normalizeProduct({
      ...base,
      offers: [
        { url: "u1", domain: "www.Target.com", price: { price: 24.99, currency: "USD" }, availability: "InStock" },
        { url: "u2", domain: "walmart.com", price: { price: 19.5, currency: "USD" }, availability: "OutOfStock" },
        { url: "u3", domain: "amazon.com", price: { amount: 22.1, currency: "USD" }, availability: "InStock" },
        { url: "u4", domain: "eu.shop", price: { price: 5, currency: "EUR" }, availability: "InStock" },
      ],
    });
    expect(p).toMatchObject({ merchant: "amazon.com", priceCents: 2210, url: "u3", imageUrl: "https://img/1c.jpg" });
  });

  it("builds category tags from slug, title and path", () => {
    const p = normalizeProduct({ ...base, offers: [{ url: "u", domain: "a.com", price: { price: 1, currency: "USD" } }] });
    expect(p?.category).toBe("Coffee Beans");
    expect(p?.categoryTags).toEqual(expect.arrayContaining(["coffee-beans", "coffee beans", "coffee", "food", "beverages"]));
  });

  it("returns null when nothing is purchasable", () => {
    expect(normalizeProduct({ ...base, offers: [] })).toBeNull();
  });

  it("avoids float rounding errors", () => {
    const p = normalizeProduct({ ...base, offers: [{ url: "u", domain: "a.com", price: { price: 19.99, currency: "USD" } }] });
    expect(p?.priceCents).toBe(1999);
  });

  it("parses the documented API shape: CategoryRef objects in path, price.price", () => {
    const raw = {
      id: "p1",
      title: "Espresso Beans",
      offers: [{ url: "u", domain: "shop.com", price: { price: 12.5, compare_at_price: null, currency: "USD" }, availability: "InStock" }],
      category: { slug: "coffee-beans", title: "Coffee Beans", path: [{ slug: "food", title: "Food" }, { slug: "coffee-beans", title: "Coffee Beans" }], has_children: false },
    };
    const [p] = parseProducts([raw]);
    expect(p).toMatchObject({ priceCents: 1250, merchant: "shop.com", category: "Coffee Beans" });
    expect(p.categoryTags).toEqual(expect.arrayContaining(["food", "coffee-beans", "coffee beans"]));
  });

  it("skips malformed products instead of failing the whole search", () => {
    const good = { id: "g", title: "Good", offers: [{ url: "u", domain: "a.com", price: { price: 1, currency: "USD" }, availability: "InStock" }] };
    expect(parseProducts([{ nope: true }, good]).map((p) => p.id)).toEqual(["g"]);
  });
});
