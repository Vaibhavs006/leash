import { describe, expect, it } from "vitest";
import { centsToValue, valueToCents } from "./api";

describe("money conversion", () => {
  it.each([[0, "0.00"], [5, "0.05"], [450, "4.50"], [123456, "1234.56"]])("%i cents -> %s", (c, v) => {
    expect(centsToValue(c)).toBe(v);
    expect(valueToCents(v)).toBe(c);
  });
  it("parses PayPal values without decimals or with one decimal", () => {
    expect(valueToCents("12")).toBe(1200);
    expect(valueToCents("12.5")).toBe(1250);
  });
  it("rejects fractional or negative cents", () => {
    expect(() => centsToValue(1.5)).toThrow();
    expect(() => centsToValue(-1)).toThrow();
  });
});
