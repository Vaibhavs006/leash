import { describe, expect, it } from "vitest";
import { normalizeProduct } from "./channel3";

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
});
