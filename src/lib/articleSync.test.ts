import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSavedArticlePayload, syncSavedArticleIfEnabled } from "./articleSync";
import type { ArticleAnalysis, SavedAnalysis } from "../types";

afterEach(() => vi.unstubAllGlobals());

function fakeSavedArticle(overrides: Partial<ArticleAnalysis> = {}): SavedAnalysis {
  const analysis: ArticleAnalysis = {
    id: "analysis_1",
    url: "https://example.com/story",
    pageTitle: "Example story",
    sourceName: "Example News",
    author: "",
    publishedAt: "",
    contentType: "article",
    genre: "general",
    summary: "The article reports a policy change.",
    confidenceScore: 60,
    confidenceReason: "",
    summaryEvidenceIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    evidence: [],
    mainIssue: { text: "Policy change", evidenceIds: [], confidenceScore: 58, confidenceLabel: "Medium" },
    framingNotes: [{ text: "Economic framing detected", evidenceIds: [], confidenceScore: 50, confidenceLabel: "Medium" }],
    loadedLanguageExamples: [],
    sourcesAndVoices: [],
    sourceSummary: "",
    sourceEvents: [],
    sourceCoverage: { processedCharacterCount: 0, totalCharacterCount: 0, blockCount: 0, skippedBlockCount: 0, skippedCharacterCount: 0, skipped: false, truncated: false },
    framingProfile: { dominantFrames: [] },
    backendBias: {
      source: "local-heuristic",
      scores: {
        political_bias: { score: 20, confidence: 0.5, evidenceCount: 1, status: "assessed" },
        gender_bias: { score: null, confidence: 0.35, evidenceCount: 0, status: "insufficient-evidence" },
        ethnicity_bias: { score: null, confidence: 0.35, evidenceCount: 0, status: "insufficient-evidence" },
        class_bias: { score: null, confidence: 0.35, evidenceCount: 0, status: "insufficient-evidence" }
      },
      linguistic_evidence: { spin_words_detected: [], target_dependent_asymmetries: [], counterfactual_sentiment_delta: 0, signals: [] },
      contextual_analysis: { stereotypical_associations: [] }
    },
    ...overrides
  };
  return {
    id: analysis.id,
    url: analysis.url,
    pageTitle: analysis.pageTitle,
    contentType: analysis.contentType,
    createdAt: analysis.createdAt,
    summary: analysis.summary,
    confidenceScore: analysis.confidenceScore,
    analysis
  };
}

describe("buildSavedArticlePayload", () => {
  it("maps a saved article analysis to the sync payload shape", () => {
    const saved = fakeSavedArticle();
    const payload = buildSavedArticlePayload(saved);
    expect(payload).toMatchObject({
      articleUrl: "https://example.com/story",
      articleTitle: "Example story",
      savedAt: "2026-01-01T00:00:00.000Z",
      summary: "The article reports a policy change."
    });
    expect(payload?.biasScores.political_bias.score).toBe(20);
    expect(payload?.framingNotes[0].text).toBe("Economic framing detected");
  });

  it("returns null for a saved bill, since only article analyses sync", () => {
    const saved = fakeSavedArticle();
    const billSaved: SavedAnalysis = { ...saved, contentType: "bill", analysis: { ...saved.analysis, contentType: "bill" } as unknown as ArticleAnalysis };
    expect(buildSavedArticlePayload(billSaved)).toBeNull();
  });

  it("returns null when the analysis never got a bias assessment", () => {
    const saved = fakeSavedArticle({ backendBias: undefined });
    expect(buildSavedArticlePayload(saved)).toBeNull();
  });
});

describe("syncSavedArticleIfEnabled", () => {
  it("does nothing when the user has not opted in", async () => {
    vi.stubGlobal("chrome", { storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn() } } });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const synced = await syncSavedArticleIfEnabled(fakeSavedArticle());
    expect(synced).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts the payload with the stored bearer token when opted in and connected", async () => {
    const get = vi.fn().mockResolvedValue({
      "ellipsis.articleSyncSettings": { enabled: true, consentedAt: "2026-01-01T00:00:00.000Z" },
      "ellipsis.unframedConnection": { token: "ellu_test", connectedAt: "2026-01-01T00:00:00.000Z" }
    });
    vi.stubGlobal("chrome", { storage: { local: { get, set: vi.fn() } } });
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    const synced = await syncSavedArticleIfEnabled(fakeSavedArticle());
    expect(synced).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/api/saved-articles"),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer ellu_test" }) })
    );
  });
});
