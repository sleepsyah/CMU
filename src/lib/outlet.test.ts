import { describe, expect, it } from "vitest";
import {
  clampPlacement,
  lookupBundledOutlet,
  normalizeOutletHost,
  OUTLET_DATA_SOURCES,
  OUTLET_NON_US_CAVEAT,
  OUTLET_PLACEMENT_DISCLAIMER,
  partisanshipLabel,
  qualityLabel,
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
    expect(profile?.placement?.quality).toBeGreaterThan(80);
  });

  it("cites both source datasets on every bundled placement", () => {
    const profile = lookupBundledOutlet("nytimes.com");
    expect(profile?.citations).toHaveLength(OUTLET_DATA_SOURCES.length);
    expect(profile?.citations.map((citation) => citation.url)).toEqual(OUTLET_DATA_SOURCES.map((source) => source.url));
  });

  it("adds the non-US caveat only for outlets based outside the United States", () => {
    expect(lookupBundledOutlet("theguardian.com")?.placement?.note).toContain(OUTLET_NON_US_CAVEAT);
    expect(lookupBundledOutlet("nytimes.com")?.placement?.note).not.toContain(OUTLET_NON_US_CAVEAT);
  });

  it("matches subdomain hosts against dataset domains", () => {
    expect(lookupBundledOutlet("live.dailymail.co.uk")?.name).toBe("Daily Mail");
    expect(lookupBundledOutlet("https://abcnews.go.com/Politics/story")?.name).toBe("ABC News");
  });

  it("returns undefined for outlets outside the dataset", () => {
    expect(lookupBundledOutlet("https://smalltownherald.example.com/news/1")).toBeUndefined();
  });

  it("profiles a curated outlet the datasets do not cover, but does not place it", () => {
    const profile = lookupBundledOutlet("semafor.com");
    expect(profile?.name).toBe("Semafor");
    expect(profile?.placement).toBeNull();
  });

  it("keeps every bundled placement inside the chart bounds", () => {
    for (const point of referenceOutlets()) {
      expect(point.quality).toBeGreaterThanOrEqual(0);
      expect(point.quality).toBeLessThanOrEqual(100);
      expect(point.partisanship).toBeGreaterThanOrEqual(-100);
      expect(point.partisanship).toBeLessThanOrEqual(100);
    }
  });
});

describe("reference outlets for the chart", () => {
  it("provides a spectrum of reference points excluding the current outlet", () => {
    const all = referenceOutlets();
    expect(all.length).toBeGreaterThanOrEqual(15);
    expect(all.some((point) => point.partisanship <= -40)).toBe(true);
    expect(all.some((point) => point.partisanship >= 20)).toBe(true);

    const withoutFox = referenceOutlets("https://www.foxnews.com/politics/story");
    expect(withoutFox.some((point) => point.host === "foxnews.com")).toBe(false);
    expect(withoutFox.length).toBe(all.length - 1);
  });

  it("ships an icon for nearly every reference outlet", () => {
    const all = referenceOutlets();
    expect(all.filter((point) => point.icon).length).toBeGreaterThanOrEqual(all.length - 2);
  });
});

describe("placement labels and clamping", () => {
  it("labels rated quality bands in plain language", () => {
    expect(qualityLabel(92)).toMatch(/very high/i);
    expect(qualityLabel(30)).toMatch(/very low/i);
  });

  // The axis measures who shares an outlet, not where it stands. Labels must
  // never say "left" or "right", or a wire service at -22 reads as partisan.
  it("labels partisanship as sharing behaviour rather than editorial stance", () => {
    expect(partisanshipLabel(0)).toMatch(/both parties/i);
    expect(partisanshipLabel(-45)).toMatch(/democrats/i);
    expect(partisanshipLabel(50)).toMatch(/republicans/i);
    for (const value of [-80, -30, 0, 30, 80]) {
      expect(partisanshipLabel(value)).not.toMatch(/\b(left|right|centrist)\b/i);
    }
  });

  it("clamps out-of-range placements", () => {
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
      icon: null,
      placement: { quality: 140, partisanship: -180, note: OUTLET_PLACEMENT_DISCLAIMER },
      citations: [{ url: "https://example.org/assessment", label: "Assessment" }],
      generatedAt: new Date().toISOString()
    });
    expect(clamped.placement?.quality).toBe(100);
    expect(clamped.placement?.partisanship).toBe(-100);
  });
});
