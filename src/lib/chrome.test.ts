import { describe, expect, it } from "vitest";
import { siteAccessPattern } from "./chrome";

describe("siteAccessPattern", () => {
  it("limits optional access to the current web origin", () => {
    expect(siteAccessPattern("https://news.example.com/story?id=4")).toBe("https://news.example.com/*");
    expect(siteAccessPattern("http://localhost:4321/article")).toBe("http://localhost:4321/*");
  });

  it("rejects protected and malformed URLs", () => {
    expect(siteAccessPattern("chrome://extensions")).toBeNull();
    expect(siteAccessPattern("file:///tmp/story.html")).toBeNull();
    expect(siteAccessPattern("not a url")).toBeNull();
  });
});
