import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzePageWithBackend, isLoopbackBackendUrl } from "./backend";
import { createManualPage } from "./chrome";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("backend model bias scales", () => {
  it("uses backend scores directly and links model evidence to short passages", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        scores: {
          political_bias: { score: 72, confidence: 0.83 },
          gender_bias: { score: 18, confidence: 0.74 },
          ethnicity_bias: { score: 41, confidence: 0.69 }
        },
        linguistic_evidence: {
          spin_words_detected: ["radical"],
          target_dependent_asymmetries: [],
          counterfactual_sentiment_delta: 0.12
        },
        contextual_analysis: {
          missing_perspectives: ["Informational parity check raised a missing counter-perspective."],
          stereotypical_associations: ["Ethnicity association should be checked against the cited evidence."]
        }
      })
    })));

    const analysis = await analyzePageWithBackend(createManualPage(
      "The mayor called the proposal radical during Monday's hearing. Officials said the plan would change tax filings. " +
        "The article described immigrants as a threat to the city. Community leaders disputed that framing.",
      "article",
      { title: "City hearing" }
    ));

    expect(analysis.backendBias?.source).toBe("hybrid-backend");
    expect(analysis.backendBias?.scores.political_bias.score).toBe(72);
    expect(analysis.backendBias?.scores.gender_bias.score).toBe(18);
    expect(analysis.backendBias?.scores.ethnicity_bias.score).toBe(41);
    expect(analysis.backendBias?.linguistic_evidence.signals[0].context.split(/[.!?]\s+/).length).toBeLessThanOrEqual(3);
  });

  it("falls back to clearly marked heuristic scores when the backend helper fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("connection refused");
    }));

    const analysis = await analyzePageWithBackend(createManualPage(
      "The mayor called the proposal radical during Monday's hearing. Officials said the plan would change tax filings.",
      "article"
    ));

    expect(analysis.backendBias?.source).toBe("local-fallback");
    expect(analysis.backendBias?.scores.political_bias.status).toBe("assessed");
    expect(analysis.backendBias?.scores.political_bias.score).toBeGreaterThan(1);
    expect(analysis.backendBias?.contextual_analysis.missing_perspectives[0]).toContain("heuristic fallback");
  });
});

describe("local helper privacy boundary", () => {
  it("accepts only explicit loopback HTTP endpoints", () => {
    expect(isLoopbackBackendUrl("http://127.0.0.1:8000")).toBe(true);
    expect(isLoopbackBackendUrl("http://localhost:8000")).toBe(true);
    expect(isLoopbackBackendUrl("https://api.example.com")).toBe(false);
    expect(isLoopbackBackendUrl("http://192.168.1.20:8000")).toBe(false);
  });
});
