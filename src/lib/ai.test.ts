import { afterEach, describe, expect, it, vi } from "vitest";
import { beginCodexLogin, checkAiConnection, checkCodexConnection, enhanceAnalysisWithAi, enhanceAnalysisWithCodex, NO_PERSPECTIVES_MESSAGE, subscribeCodexProgress, validateSourceParticipation } from "./ai";
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
      source_participation: {
        named_sources: [{ name: "NASA", affiliation: "NASA", source_type: "institution", evidence_quote: "NASA said Artemis II carries four astronauts around the Moon and returns them to Earth." }],
        attributed_perspectives: [{ name: "NASA", type: "institution", position: "Presents the mission as preparation for later lunar missions.", supported_by: ["NASA"], evidence_quote: "NASA said Artemis II carries four astronauts around the Moon and returns them to Earth." }]
      },
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
    expect(result.contentType === "article" && result.quotedPeopleOrGroups[0].text).toBe("NASA");

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
});

describe("AI perspective validation", () => {
  it("rejects weekdays, dates, a city, and an article topic", () => {
    const text = "On Monday, Pittsburgh discussed immigration. On Tuesday, officials scheduled another meeting for July 14, 2026.";
    const result = validateSourceParticipation(text, {
      named_sources: [
        { name: "Monday", affiliation: "", source_type: "other_stakeholder", evidence_quote: text },
        { name: "Pittsburgh", affiliation: "", source_type: "institution", evidence_quote: text }
      ],
      attributed_perspectives: [
        { name: "Monday", type: "other_stakeholder", position: "Opened the discussion.", supported_by: ["Monday"], evidence_quote: text },
        { name: "Tuesday", type: "other_stakeholder", position: "Continued the discussion.", supported_by: ["Monday"], evidence_quote: text },
        { name: "July 14, 2026", type: "other_stakeholder", position: "Was selected for a meeting.", supported_by: ["Monday"], evidence_quote: text },
        { name: "Pittsburgh", type: "institution", position: "Discussed the issue.", supported_by: ["Pittsburgh"], evidence_quote: text },
        { name: "immigration", type: "other_stakeholder", position: "Was discussed.", supported_by: ["Pittsburgh"], evidence_quote: text }
      ]
    });
    expect(result.namedSources).toEqual([]);
    expect(result.perspectives).toEqual([]);
  });

  it("accepts a government source and the broader government perspective it supports", () => {
    const evidence = "Jane Smith of the City Council said the proposal would reduce costs.";
    const result = validateSourceParticipation(evidence, {
      named_sources: [{ name: "Jane Smith", affiliation: "City Council", source_type: "government", evidence_quote: evidence }],
      attributed_perspectives: [{ name: "City government", type: "government", position: "Supports the proposal as a way to reduce costs.", supported_by: ["Jane Smith"], evidence_quote: evidence }]
    });
    expect(result.namedSources.map((item) => item.name)).toEqual(["Jane Smith"]);
    expect(result.perspectives).toMatchObject([{ name: "City government", type: "government", supported_by: ["Jane Smith"] }]);
  });

  it("accepts quoted local residents as an affected-group perspective", () => {
    const evidence = "Local residents said the closure would make it harder to reach medical care.";
    const result = validateSourceParticipation(evidence, {
      named_sources: [{ name: "Local residents", affiliation: "", source_type: "affected_group", evidence_quote: evidence }],
      attributed_perspectives: [{ name: "Local residents", type: "affected_group", position: "Oppose the closure because it would limit access to care.", supported_by: ["Local residents"], evidence_quote: evidence }]
    });
    expect(result.perspectives).toHaveLength(1);
    expect(result.perspectives[0].type).toBe("affected_group");
  });

  it("rejects fabricated evidence and invalid perspective types", () => {
    const evidence = "Jane Smith of the City Council said the proposal would reduce costs.";
    const result = validateSourceParticipation(evidence, {
      named_sources: [{ name: "Jane Smith", affiliation: "City Council", source_type: "government", evidence_quote: evidence }],
      attributed_perspectives: [
        { name: "City government", type: "government", position: "Supports the proposal.", supported_by: ["Jane Smith"], evidence_quote: "Jane Smith said the proposal would save millions." },
        { name: "City government", type: "location", position: "Supports the proposal.", supported_by: ["Jane Smith"], evidence_quote: evidence }
      ]
    });
    expect(result.perspectives).toEqual([]);
  });

  it("removes duplicate perspectives and safely represents an empty result", () => {
    const evidence = "Local residents said the closure would make it harder to reach medical care.";
    const perspective = { name: "Local residents", type: "affected_group", position: "Oppose the closure.", supported_by: ["Local residents"], evidence_quote: evidence };
    const deduped = validateSourceParticipation(evidence, {
      named_sources: [{ name: "Local residents", affiliation: "", source_type: "affected_group", evidence_quote: evidence }],
      attributed_perspectives: [perspective, { ...perspective }]
    });
    expect(deduped.perspectives).toHaveLength(1);
    expect(validateSourceParticipation("The report was released Monday.", { named_sources: [], attributed_perspectives: [] }).perspectives).toEqual([]);
    expect(NO_PERSPECTIVES_MESSAGE).toBe("No clearly represented stakeholder perspectives were identified.");
  });
});
