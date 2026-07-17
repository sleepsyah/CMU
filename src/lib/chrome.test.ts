import { afterEach, describe, expect, it, vi } from "vitest";
import { highlightActivePagePassage, siteAccessPattern } from "./chrome";

afterEach(() => vi.unstubAllGlobals());

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

describe("article passage highlighting", () => {
  it("does not reinject the content script when a running highlighter reports no match", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: false });
    const executeScript = vi.fn();
    vi.stubGlobal("chrome", {
      tabs: { query: vi.fn().mockResolvedValue([{ id: 7, url: "https://example.com/article" }]), sendMessage },
      scripting: { executeScript }
    });

    await expect(highlightActivePagePassage("A cited passage.")).resolves.toBe(false);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("injects once when the content script is genuinely missing", async () => {
    const sendMessage = vi.fn()
      .mockRejectedValueOnce(new Error("Receiving end does not exist"))
      .mockResolvedValueOnce({ ok: true });
    const executeScript = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", {
      tabs: { query: vi.fn().mockResolvedValue([{ id: 7, url: "https://example.com/article" }]), sendMessage },
      scripting: { executeScript }
    });

    await expect(highlightActivePagePassage("A cited passage.")).resolves.toBe(true);
    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});
