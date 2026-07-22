import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmSync,
  currentWeekOf,
  getPendingDigest,
  getSyncStatusLabel,
  markConnectPromptShown,
  recordArticleAnalysis,
  shouldShowConnectPrompt
} from "./digest";

afterEach(() => vi.unstubAllGlobals());

function fakeChromeStorage() {
  const store: Record<string, unknown> = {};
  const get = vi.fn(async (key: string) => ({ [key]: store[key] }));
  const set = vi.fn(async (obj: Record<string, unknown>) => {
    Object.assign(store, obj);
  });
  vi.stubGlobal("chrome", { storage: { local: { get, set } } });
  return store;
}

describe("currentWeekOf", () => {
  it("always resolves to a Monday", () => {
    for (let offset = 0; offset < 14; offset += 1) {
      const date = new Date(2026, 0, 1 + offset);
      const parsed = new Date(`${currentWeekOf(date)}T00:00:00`);
      expect(parsed.getDay()).toBe(1);
    }
  });

  it("stays the same across a Monday-to-Sunday week and advances the week after", () => {
    const day = new Date(2026, 2, 10);
    const weekOf = currentWeekOf(day);
    const monday = new Date(`${weekOf}T00:00:00`);
    for (let offset = 0; offset < 7; offset += 1) {
      expect(currentWeekOf(new Date(monday.getTime() + offset * 86_400_000))).toBe(weekOf);
    }
    expect(currentWeekOf(new Date(monday.getTime() + 7 * 86_400_000))).not.toBe(weekOf);
  });
});

describe("weekly aggregate tracking", () => {
  it("accumulates analyzed articles into a pending digest", async () => {
    fakeChromeStorage();
    await recordArticleAnalysis({ biasLevel: "moderate", topics: ["healthcare"], sourceUrl: "https://news.example.com/a" });
    await recordArticleAnalysis({ biasLevel: "low", topics: ["healthcare", "housing"], sourceUrl: "https://other.example.com/b" });
    await recordArticleAnalysis({ biasLevel: "low", topics: [], sourceUrl: "https://news.example.com/c" });

    const pending = await getPendingDigest();
    expect(pending?.articlesAnalyzed).toBe(3);
    expect(pending?.biasLevelCounts).toMatchObject({ low: 2, moderate: 1, high: 0, minimal: 0 });
    expect(pending?.topicCounts).toMatchObject({ healthcare: 2, housing: 1 });
    expect(pending?.sourceCount).toBe(2); // news.example.com counted once despite two articles
  });

  it("never stores article URLs or titles, only hostnames for the dedup count", async () => {
    const store = fakeChromeStorage();
    await recordArticleAnalysis({ biasLevel: "high", topics: [], sourceUrl: "https://news.example.com/secret-investigation-title" });
    const raw = JSON.stringify(store);
    expect(raw).not.toContain("secret-investigation-title");
    expect(raw).toContain("news.example.com");
  });

  it("clears the pending digest and resets counters after confirmSync", async () => {
    fakeChromeStorage();
    await recordArticleAnalysis({ biasLevel: "high", topics: ["labor"], sourceUrl: "https://news.example.com/a" });
    const pending = await getPendingDigest();
    expect(pending).not.toBeNull();

    await confirmSync(pending!.weekOf);
    expect(await getPendingDigest()).toBeNull();
    expect(await getSyncStatusLabel()).toBe("Reading digest synced today");
  });

  it("reports not connected until the first sync completes, and prompts at most once a week", async () => {
    fakeChromeStorage();
    expect(await getSyncStatusLabel()).toBe("Not connected to dashboard");
    expect(await shouldShowConnectPrompt()).toBe(true);
    await markConnectPromptShown();
    expect(await shouldShowConnectPrompt()).toBe(false);
  });
});
