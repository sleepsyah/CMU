import { afterEach, describe, expect, it, vi } from "vitest";
import { beginCodexLogin, checkAiConnection, checkCodexConnection, enhanceAnalysisWithAi, enhanceAnalysisWithCodex, subscribeCodexProgress } from "./ai";
import { analyzePage } from "./analysis";

afterEach(() => vi.unstubAllGlobals());

describe("native Codex connection", () => {
  it("reads connection status through the extension service worker", async () => {
    const status = { provider: "codex", providerStatus: "ready", providerMessage: "Connected.", model: "gpt-5.5", reasoningEffort: "low", runtime: "Codex app-server", checkedAt: "2026-01-01" };
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, result: status });
    vi.stubGlobal("chrome", { runtime: { id: "extension", sendMessage } });
    await expect(checkCodexConnection()).resolves.toEqual(status);
    expect(sendMessage).toHaveBeenCalledWith({ type: "ellipsis.ai.request", action: "status", payload: { provider: "codex" } });
  });

  it("returns the browser sign-in URL from the native host", async () => {
    const login = { status: { providerStatus: "needs_auth" }, authUrl: "https://chatgpt.com/auth" };
    vi.stubGlobal("chrome", { runtime: { id: "extension", sendMessage: vi.fn().mockResolvedValue({ ok: true, result: login }) } });
    await expect(beginCodexLogin()).resolves.toEqual(login);
  });

  it("requests Claude Code status through the same native connector", async () => {
    const status = { provider: "claude", providerStatus: "needs_auth", providerMessage: "Sign in required.", model: "claude-sonnet-4-6", reasoningEffort: "low", runtime: "Claude Code CLI", checkedAt: "2026-01-01" };
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, result: status });
    vi.stubGlobal("chrome", { runtime: { id: "extension", sendMessage } });
    await expect(checkAiConnection("claude")).resolves.toEqual(status);
    expect(sendMessage).toHaveBeenCalledWith({ type: "ellipsis.ai.request", action: "status", payload: { provider: "claude" } });
  });

  it("explains when the native connector is unavailable outside Chrome", async () => {
    await expect(checkCodexConnection()).rejects.toThrow(/installed Chrome extension/i);
  });

  it("forwards streamed native progress and removes its listener", () => {
    let registered: ((message: unknown) => void) | undefined;
    const addListener = vi.fn((listener) => { registered = listener; });
    const removeListener = vi.fn();
    vi.stubGlobal("chrome", { runtime: { id: "extension", onMessage: { addListener, removeListener } } });
    const listener = vi.fn();
    const unsubscribe = subscribeCodexProgress(listener);
    const event = { runId: "run-1", id: "reasoning-1", kind: "reasoning", status: "completed", title: "Reasoning summary", at: "2026-01-01" };
    registered?.({ type: "ellipsis.ai.progress", event });
    expect(listener).toHaveBeenCalledWith(event);
    unsubscribe();
    expect(removeListener).toHaveBeenCalledWith(registered);
  });

  it("keeps researched claim checks linked to exact source text and citations", async () => {
    const sourceText = "NASA said Artemis II carries four astronauts around the Moon and returns them to Earth. The mission tests the Orion spacecraft with people aboard and prepares for later lunar missions. Officials identified Reid Wiseman, Victor Glover, Christina Koch, and Jeremy Hansen as the crew.";
    const page = {
      title: "Artemis II",
      url: "https://example.com/artemis",
      sourceName: "Example",
      author: "",
      publishedAt: "",
      text: sourceText,
      contentType: "article" as const,
      links: []
    };
    const payload = {
      summary: "NASA says Artemis II carries four astronauts around the Moon and tests Orion before later lunar missions.",
      summary_evidence: ["NASA said Artemis II carries four astronauts around the Moon and returns them to Earth."],
      genre: "event",
      overall_bias: {
        score: 12,
        level: "minimal",
        summary: "The article frames Artemis II through NASA’s institutional goals, emphasizing safety and progress over conflict. Its mostly factual, attributed language gives that promotional emphasis limited force rather than creating a strong evaluative slant."
      },
      confidence_score: 76,
      confidence_reason: "The material claims were checked against an official source.",
      frames: [],
      signals: [],
      review_questions: [],
      findings: [{ section: "main_issue", text: "Artemis II is a crewed lunar test mission.", evidence_quote: "NASA said Artemis II carries four astronauts around the Moon and returns them to Earth." }],
      important_terms: [],
      fact_checks: [{
        claim: "Artemis II carries four astronauts around the Moon.",
        assessment: "supported",
        explanation: "NASA describes Artemis II as a crewed lunar flyby.",
        source_quote: "NASA said Artemis II carries four astronauts around the Moon and returns them to Earth.",
        citations: [{ url: "https://www.nasa.gov/mission/artemis-ii/", label: "NASA Artemis II", evidence: "NASA identifies Artemis II as a crewed lunar flyby." }]
      }],
      _trace: { reasoning_summaries: ["Checking mission details"], runtime_ms: 1200, web_search_queries: ["NASA Artemis II mission"] }
    };
    vi.stubGlobal("chrome", { runtime: { id: "extension", sendMessage: vi.fn().mockResolvedValue({ ok: true, result: payload }) } });
    const result = await enhanceAnalysisWithCodex(analyzePage(page), page, "trace-1");
    expect(result.aiAnalysis?.factChecks).toHaveLength(1);
    expect(result.aiAnalysis?.factChecks?.[0].sourceText).toBe(payload.fact_checks[0].source_quote);
    expect(result.aiAnalysis?.factChecks?.[0].citations[0].url).toBe("https://www.nasa.gov/mission/artemis-ii/");
    expect(result.aiAnalysis?.researchSourceCount).toBe(1);
    expect(result.aiAnalysis?.outputSummary).toBe(payload.summary);
    expect(result.backendBias?.source).toBe("codex-enhanced");
    expect(result.biasProfile).toEqual(payload.overall_bias);
    expect(result.contentType === "article" && result.genre).toBe("event");
    expect(result.contentType === "article" && result.sourcesAndVoices[0].displayName).toBe("NASA");

    const cutoffSummary = "The article reports that Sen. Elissa Slotkin said the SAVE America Act would make it harder for Democrats to win elections and frames Republican responses as accusing Democrats of opposing stricter election rules because they benefit from weak verification. It also describes the bill’s proof-of-citizenship and voter ID provisions, Slotkin’s concerns about married women, Trump’s cheating claims, and Fox News Digital’s";
    expect(cutoffSummary).toHaveLength(420);
    vi.stubGlobal("chrome", { runtime: { id: "extension", sendMessage: vi.fn().mockResolvedValue({ ok: true, result: { ...payload, summary: cutoffSummary } }) } });
    const cutoffResult = await enhanceAnalysisWithCodex(analyzePage(page), page, "trace-cutoff");
    expect(cutoffResult.summary).toBe("The article reports that Sen. Elissa Slotkin said the SAVE America Act would make it harder for Democrats to win elections and frames Republican responses as accusing Democrats of opposing stricter election rules because they benefit from weak verification.");
    expect(cutoffResult.aiAnalysis?.outputSummary).toBe(cutoffResult.summary);

    const noResearchPayload = {
      ...payload,
      fact_checks: [],
      _trace: { ...payload._trace, web_search_queries: [] }
    };
    vi.stubGlobal("chrome", { runtime: { id: "extension", sendMessage: vi.fn().mockResolvedValue({ ok: true, result: noResearchPayload }) } });
    const noResearchResult = await enhanceAnalysisWithCodex(analyzePage(page), page, "trace-2");
    expect(noResearchResult.aiAnalysis?.factChecks).toEqual([]);
    expect(noResearchResult.aiAnalysis?.webSearchCount).toBe(0);

    vi.stubGlobal("chrome", { runtime: { id: "extension", sendMessage: vi.fn().mockResolvedValue({ ok: true, result: payload }) } });
    const claudeResult = await enhanceAnalysisWithAi(analyzePage(page), page, "claude", "trace-3");
    expect(claudeResult.aiAnalysis?.provider).toBe("claude");
    expect(claudeResult.aiAnalysis?.model).toBe("claude-sonnet-4-6");
    expect(claudeResult.backendBias?.source).toBe("ai-enhanced");

  });

  it("repairs missing optional AI arrays while keeping source validation active", async () => {
    const page = {
      title: "Transit hearing",
      url: "https://example.com/transit",
      sourceName: "Example",
      author: "",
      publishedAt: "",
      text: "The city council held a public hearing on the proposed transit schedule. Officials said the plan would add two evening routes and move one morning departure. Council members will vote after reviewing public comments next week.",
      contentType: "article" as const,
      links: []
    };
    const partialPayload = {
      summary: "The council is reviewing a transit schedule that would add evening routes and change one morning departure.",
      summary_evidence: ["Officials said the plan would add two evening routes and move one morning departure."],
      overall_bias: { score: 10, level: "minimal" },
      findings: [{
        section: "main_issue",
        text: "The council is considering a revised transit schedule.",
        evidence_quote: "The city council held a public hearing on the proposed transit schedule."
      }]
    };
    vi.stubGlobal("chrome", { runtime: { id: "extension", sendMessage: vi.fn().mockResolvedValue({ ok: true, result: partialPayload }) } });
    const result = await enhanceAnalysisWithCodex(analyzePage(page), page, "trace-partial");
    expect(result.aiAnalysis?.summaryRefined).toBe(true);
    expect(result.aiAnalysis?.factChecks).toEqual([]);
    expect(result.biasProfile?.score).toBe(10);
  });

  it("rejects prose-only AI output without breaking the local analysis", async () => {
    const page = {
      title: "Transit hearing",
      url: "https://example.com/transit",
      sourceName: "Example",
      author: "",
      publishedAt: "",
      text: "The city council held a public hearing on the proposed transit schedule. Officials said the plan would add two evening routes and move one morning departure. Council members will vote after reviewing public comments next week.",
      contentType: "article" as const,
      links: []
    };
    vi.stubGlobal("chrome", { runtime: { id: "extension", sendMessage: vi.fn().mockResolvedValue({ ok: true, result: "This is not structured JSON." }) } });
    await expect(enhanceAnalysisWithCodex(analyzePage(page), page, "trace-invalid")).rejects.toThrow(/usable structured analysis/i);
  });
});
