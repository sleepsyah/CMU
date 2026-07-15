import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzePageWithBackend, isLoopbackBackendUrl, localBiasAssessment } from "./backend";

afterEach(() => vi.unstubAllGlobals());

const page = {
  title: "Council proposal",
  url: "https://example.com/council",
  sourceName: "Example",
  author: "",
  publishedAt: "",
  text: "The mayor called the proposal radical and warned that it could damage the city budget. Supporters said the plan would protect tenants, while the budget office said its estimate was still incomplete.",
  contentType: "article" as const,
  links: []
};

describe("evidence-linked bias scales", () => {
  it("does not infer ethnicity bias from crime words without a direct group association", () => {
    const result = localBiasAssessment(
      "City officials reported that violent crime declined across every district. Black and white residents reviewed the data before publication. The report does not claim that any demographic group caused the change."
    );

    expect(result.scores.ethnicity_bias.status).toBe("insufficient-evidence");
    expect(result.scores.ethnicity_bias.score).toBeNull();
  });

  it("requires a direct, non-negated demographic association", () => {
    const result = localBiasAssessment(
      "The column described immigrants as criminals and a threat to every neighborhood. Independent records were not cited in the article."
    );

    expect(result.scores.ethnicity_bias.status).toBe("assessed");
    expect(result.scores.ethnicity_bias.evidenceCount).toBeGreaterThan(0);
    expect(result.linguistic_evidence.signals.some((signal) => signal.dimension === "ethnicity")).toBe(true);
  });

  it("does not score a gender stereotype word without a gender association", () => {
    const result = localBiasAssessment(
      "The committee called the negotiating process emotional and chaotic. Members later published a detailed timeline of the dispute."
    );

    expect(result.scores.gender_bias.status).toBe("insufficient-evidence");
  });

  it("links political wording scores to exact cues", () => {
    const result = localBiasAssessment(
      "The mayor blasted the radical proposal as a disastrous betrayal. The council published the proposal later that afternoon."
    );

    expect(result.scores.political_bias.status).toBe("assessed");
    expect(result.scores.political_bias.evidenceCount).toBeGreaterThan(0);
    expect(result.linguistic_evidence.signals.every((signal) => signal.context.length > 0)).toBe(true);
  });

  it("requires a direct class association before scoring class bias", () => {
    const neutral = localBiasAssessment(
      "The report compared low-income and affluent districts using the same public data and published its methodology."
    );
    const framed = localBiasAssessment(
      "The column described welfare recipients as lazy and undeserving while offering no individual evidence."
    );

    expect(neutral.scores.class_bias.status).toBe("insufficient-evidence");
    expect(framed.scores.class_bias.status).toBe("assessed");
    expect(framed.linguistic_evidence.signals.some((signal) => signal.dimension === "class")).toBe(true);
  });

  it("detects research-backed persuasion patterns without turning them into verdicts", () => {
    const result = localBiasAssessment(
      "The columnist wrote that the governor secretly hopes the program will fail and that there is no alternative to immediate repeal. The article later quotes the budget office's projection."
    );

    const persuasion = result.linguistic_evidence.signals.filter((signal) => signal.category === "persuasion");
    expect(persuasion.map((signal) => signal.phrase)).toContain("mind-reading claim");
    expect(persuasion.map((signal) => signal.phrase)).toContain("black-and-white framing");
    expect(persuasion.every((signal) => signal.neutralAlternative)).toBe(true);
  });
});

describe("local helper privacy boundary", () => {
  it("accepts only explicit loopback HTTP endpoints", () => {
    expect(isLoopbackBackendUrl("http://127.0.0.1:8000")).toBe(true);
    expect(isLoopbackBackendUrl("http://localhost:8000")).toBe(true);
    expect(isLoopbackBackendUrl("https://api.example.com")).toBe(false);
    expect(isLoopbackBackendUrl("http://192.168.1.20:8000")).toBe(false);
  });

  it("does not contact the optional Python helper when AI is off", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await analyzePageWithBackend(page, { aiSettings: { enabled: false, provider: "codex" } });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes evidence-linked Python signals to Codex when the helper is ready", async () => {
    const backendPayload = {
      scores: {
        political_bias: { score: 60, confidence: 0.7 },
        gender_bias: { score: 3, confidence: 0.2 },
        ethnicity_bias: { score: 4, confidence: 0.2 },
        class_bias: { score: 12, confidence: 0.3 }
      },
      linguistic_evidence: {
        spin_words_detected: ["radical"],
        target_dependent_asymmetries: [],
        counterfactual_sentiment_delta: 0
      },
      contextual_analysis: { stereotypical_associations: [] }
    };
    const fetchMock = vi.fn(async (input: string | URL) => ({
      ok: true,
      json: async () => String(input).endsWith("/health") ? { status: "ok", ready: true } : backendPayload
    }));
    const sendMessage = vi.fn().mockResolvedValue({ ok: false, error: "Stop after inspecting the support payload." });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("chrome", { runtime: { id: "extension", sendMessage } });

    const result = await analyzePageWithBackend(page, { aiSettings: { enabled: true, provider: "codex" } });
    const request = sendMessage.mock.calls.find(([message]) => message.action === "analyze")?.[0];

    expect(request.payload.local_model_context.source).toBe("hybrid-backend");
    expect(request.payload.local_model_context.source_matched_signals[0].phrase).toBe("radical");
    expect(result.backendBias?.source).toBe("hybrid-backend");
    expect(result.aiFailureReason).toMatch(/inspecting the support payload/i);
  });
});
