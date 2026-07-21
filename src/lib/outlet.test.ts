import { describe, expect, it } from "vitest";
import {
  affiliationLabel,
  clampPlacement,
  factualityLabel,
  lookupBundledOutlet,
  normalizeOutletHost,
  OUTLET_PLACEMENT_DISCLAIMER,
  referenceOutlets
} from "./outlet";

describe("outlet host normalization", () => {
  it("extracts and normalizes hosts from full article URLs", () => {
    expect(normalizeOutletHost("https://www.nytimes.com/2026/07/18/us/politics/story.html")).toBe("nytimes.com");
    expect(normalizeOutletHost("https://edition.cnn.com/2026/07/18/politics/story/index.html")).toBe("cnn.com");
    expect(normalizeOutletHost("AMP.THEGUARDIAN.COM")).toBe("theguardian.com");
  });

  it("returns an empty string for unusable input", () => {
    expect(normalizeOutletHost("")).toBe("");
    expect(normalizeOutletHost("https://")).toBe("");
  });
});

describe("bundled outlet lookup", () => {
  it("profiles a known outlet with facts and a placement", () => {
    const profile = lookupBundledOutlet("https://www.reuters.com/world/story");
    expect(profile).toBeDefined();
    expect(profile?.name).toBe("Reuters");
    expect(profile?.origin).toBe("bundled-dataset");
    expect(profile?.headquarters).toContain("London");
    expect(profile?.country).toBe("United Kingdom");
    expect(profile?.ownership).toContain("Thomson Reuters");
    expect(profile?.placement?.factuality).toBeGreaterThan(80);
    expect(Math.abs(profile?.placement?.affiliation ?? 99)).toBeLessThan(10);
  });

  it("matches subdomain hosts against dataset domains", () => {
    expect(lookupBundledOutlet("live.dailymail.co.uk")?.name).toBe("Daily Mail");
    expect(lookupBundledOutlet("https://abcnews.go.com/Politics/story")?.name).toBe("ABC News");
  });

  it("returns undefined for outlets outside the dataset", () => {
    expect(lookupBundledOutlet("https://smalltownherald.example.com/news/1")).toBeUndefined();
  });

  it("keeps every bundled placement inside the chart bounds", () => {
    for (const point of referenceOutlets()) {
      expect(point.factuality).toBeGreaterThanOrEqual(0);
      expect(point.factuality).toBeLessThanOrEqual(100);
      expect(point.affiliation).toBeGreaterThanOrEqual(-100);
      expect(point.affiliation).toBeLessThanOrEqual(100);
    }
  });
});

describe("reference outlets for the chart", () => {
  it("provides a spectrum of reference points excluding the current outlet", () => {
    const all = referenceOutlets();
    expect(all.length).toBeGreaterThanOrEqual(15);
    expect(all.some((point) => point.affiliation <= -40)).toBe(true);
    expect(all.some((point) => point.affiliation >= 40)).toBe(true);
    expect(all.some((point) => Math.abs(point.affiliation) < 12)).toBe(true);

    const withoutFox = referenceOutlets("https://www.foxnews.com/politics/story");
    expect(withoutFox.some((point) => point.host === "foxnews.com")).toBe(false);
    expect(withoutFox.length).toBe(all.length - 1);
  });
});

describe("placement labels and clamping", () => {
  it("labels factuality and affiliation bands in plain language", () => {
    expect(factualityLabel(92)).toMatch(/very strong/i);
    expect(factualityLabel(30)).toMatch(/weak/i);
    expect(affiliationLabel(0)).toBe("Center");
    expect(affiliationLabel(-35)).toMatch(/leans left/i);
    expect(affiliationLabel(70)).toBe("Right");
  });

  it("clamps out-of-range researched placements", () => {
    const clamped = clampPlacement({
      host: "example.com",
      name: "Example",
      origin: "ai-research",
      headquarters: "Example City",
      country: "Exampleland",
      ownership: "Example Corp",
      funding: "Advertising",
      founded: "2000",
      medium: "Digital",
      placement: { factuality: 140, affiliation: -180, note: OUTLET_PLACEMENT_DISCLAIMER },
      citations: [{ url: "https://example.org/assessment", label: "Assessment" }],
      generatedAt: new Date().toISOString()
    });
    expect(clamped.placement?.factuality).toBe(100);
    expect(clamped.placement?.affiliation).toBe(-100);
  });
});
