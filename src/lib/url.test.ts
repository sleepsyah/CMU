import { describe, expect, it } from "vitest";
import { normalizeWebUrl } from "./url";

describe("link analysis URL validation", () => {
  it("normalizes ordinary web links and rejects protected schemes", () => {
    expect(normalizeWebUrl("example.com/story")).toBe("https://example.com/story");
    expect(normalizeWebUrl("https://www.congress.gov/bill/119th-congress/house-bill/1")).toMatch(/^https:\/\/www\.congress\.gov/);
    expect(() => normalizeWebUrl("chrome://extensions")).toThrow(/http:\/\/ and https:\/\//i);
  });
});
