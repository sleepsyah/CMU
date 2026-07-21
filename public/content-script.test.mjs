import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

function loadMatchingHelpers() {
  const source = readFileSync(new URL("./content-script.js", import.meta.url), "utf8");
  const sandbox = {
    chrome: { runtime: { onMessage: { addListener() {} } } }
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(`${source}\n;globalThis.__matching = { normalizeForSearch, normalizedIndexMap, candidateMatchScore, excerptSentences };`, sandbox);
  return sandbox.__matching;
}

const matching = loadMatchingHelpers();

describe("article passage matching", () => {
  it("treats smart quotes, typographic dashes, and ellipses as their plain-text equivalents", () => {
    expect(matching.normalizeForSearch("“Officials—said it’s ready…”"))
      .toBe('"officials-said it\'s ready..."');
    expect(matching.candidateMatchScore(
      "“Officials—said it’s ready…”",
      '"Officials-said it\'s ready..."'
    )).toBeGreaterThan(1000);
  });

  it("finds a passage when the page inserts extra attribution words", () => {
    const extracted = "Council member Jane Smith said the plan would reduce travel times for commuters.";
    const rendered = "Council member Jane Smith, speaking after Tuesday's hearing, said the plan would reduce travel times for commuters.";
    expect(matching.candidateMatchScore(rendered, extracted)).toBeGreaterThan(0);
  });

  it("keeps normalization offsets linked to the original rendered text", () => {
    const rendered = "The plan… works.";
    const result = matching.normalizedIndexMap(rendered);
    expect(result.normalized).toBe("the plan... works.");
    expect(result.map).toHaveLength(result.normalized.length);
    expect(rendered[result.map[result.normalized.indexOf("...")]]).toBe("…");
  });

  it("limits a cited passage to the first three sentences", () => {
    expect(Array.from(matching.excerptSentences("One. Two. Three. Four.", 3))).toEqual(["One.", "Two.", "Three."]);
  });
});

function loadSiteIcon(links, origin = "https://example.com") {
  const source = readFileSync(new URL("./content-script.js", import.meta.url), "utf8");
  const sandbox = {
    chrome: { runtime: { onMessage: { addListener() {} } } },
    location: { origin },
    document: {
      // Mirrors the selector in siteIconUrl: any link whose rel names an icon.
      querySelectorAll: () =>
        links
          .filter((link) => /icon/.test(link.rel))
          .map((link) => ({
            href: link.href,
            getAttribute: (name) => (name === "sizes" ? link.sizes ?? null : null)
          }))
    }
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(`${source}\n;globalThis.__siteIconUrl = siteIconUrl;`, sandbox);
  return sandbox.__siteIconUrl();
}

describe("site icon extraction", () => {
  it("prefers the declared icon closest to 64px", () => {
    expect(
      loadSiteIcon([
        { rel: "icon", href: "https://example.com/tiny.png", sizes: "16x16" },
        { rel: "icon", href: "https://example.com/right.png", sizes: "64x64" },
        { rel: "apple-touch-icon", href: "https://example.com/huge.png", sizes: "512x512" }
      ])
    ).toBe("https://example.com/right.png");
  });

  it("falls back to the conventional path when the page declares no icon", () => {
    expect(loadSiteIcon([])).toBe("https://example.com/favicon.ico");
  });

  it("ignores non-http icon declarations such as inline data URIs", () => {
    expect(loadSiteIcon([{ rel: "icon", href: "data:image/png;base64,AAAA", sizes: "64x64" }]))
      .toBe("https://example.com/favicon.ico");
  });
});
