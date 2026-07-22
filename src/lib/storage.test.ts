import { afterEach, describe, expect, it, vi } from "vitest";
import { getAiSettings, getArticleSyncSettings, getUnframedConnection, migrateSavedAnalysis, saveUnframedToken } from "./storage";
import type { SavedAnalysis } from "../types";

afterEach(() => vi.unstubAllGlobals());

describe("saved-analysis migration", () => {
  it("keeps legacy string findings readable after the evidence model upgrade", () => {
    const legacy = {
      id: "legacy",
      url: "manual://paste",
      pageTitle: "Legacy article",
      contentType: "article",
      createdAt: "2026-01-01T00:00:00.000Z",
      summary: "Summary",
      confidenceScore: 60,
      analysis: {
        id: "legacy",
        url: "manual://paste",
        pageTitle: "Legacy article",
        sourceName: "Manual paste",
        contentType: "article",
        summary: "Summary",
        confidenceScore: 60,
        confidenceReason: "Legacy",
        createdAt: "2026-01-01T00:00:00.000Z",
        evidence: [],
        mainIssue: "Legacy issue",
        framingNotes: ["Legacy framing"],
        loadedLanguageExamples: [{ phrase: "crisis", context: "A crisis was declared." }],
        quotedPeopleOrGroups: ["Jordan Lee"],
        includedPerspectives: ["Official perspective"],
        missingPerspectives: ["Expert context may be missing"]
      }
    } as unknown as SavedAnalysis;

    const migrated = migrateSavedAnalysis(legacy);
    expect(migrated?.analysis.contentType).toBe("article");
    if (!migrated || migrated.analysis.contentType !== "article") return;
    expect(migrated.analysis.mainIssue.text).toBe("Legacy issue");
    expect(migrated.analysis.framingNotes[0].confidenceLabel).toBe("Low");
    expect(migrated.analysis.loadedLanguageExamples[0].phrase).toBe("crisis");
    expect(migrated.analysis.genre).toBe("general");
    expect(migrated.analysis.framingProfile.dominantFrames).toEqual([]);
  });

  it("does not revive obsolete perspective entries as Sources and Voices", () => {
    const evidence = "Indian foreign ministry said it had summoned the deputy chief of mission of the Iranian embassy to register ‘a strong protest’ against the attacks.";
    const legacy = {
      id: "legacy-source",
      createdAt: "2026-01-01T00:00:00.000Z",
      analysis: {
        id: "legacy-source",
        url: "manual://paste",
        pageTitle: "Legacy article",
        sourceName: "Manual paste",
        contentType: "article",
        summary: "Summary",
        confidenceScore: 60,
        confidenceReason: "Legacy",
        createdAt: "2026-01-01T00:00:00.000Z",
        evidence: [],
        mainIssue: "Legacy issue",
        perspectiveSources: [{
          canonicalId: "bad-source",
          displayName: evidence,
          aliases: [evidence],
          entityType: "government",
          sourceRoles: ["quoted"],
          evidence: [{ text: evidence, attributionType: "quoted" }],
          mentionCount: 1
        }]
      }
    } as unknown as SavedAnalysis;

    const migrated = migrateSavedAnalysis(legacy);
    if (!migrated || migrated.analysis.contentType !== "article") throw new Error("Expected article migration");
    expect(migrated.analysis.sourcesAndVoices).toEqual([]);
  });

  it("preserves evidence-backed Sources and Voices entries", () => {
    const evidence = "City Council chair Jane Smith said the plan would reduce travel times.";
    const saved = {
      id: "current-source",
      createdAt: "2026-01-01T00:00:00.000Z",
      analysis: {
        id: "current-source",
        url: "manual://paste",
        pageTitle: "Current article",
        sourceName: "Manual paste",
        contentType: "article",
        summary: "Summary",
        confidenceScore: 60,
        confidenceReason: "Current",
        createdAt: "2026-01-01T00:00:00.000Z",
        evidence: [],
        mainIssue: "Current issue",
        sourcesAndVoices: [{
          canonicalId: "source-jane-smith",
          displayName: "Jane Smith",
          aliases: ["Jane Smith"],
          entityType: "person",
          sourceRoles: ["paraphrased"],
          contributionSummary: "Stated that the plan would reduce travel times.",
          evidence: [{ evidenceText: evidence, attributionType: "paraphrased" }],
          mentionCount: 1
        }]
      }
    } as unknown as SavedAnalysis;

    const migrated = migrateSavedAnalysis(saved);
    if (!migrated || migrated.analysis.contentType !== "article") throw new Error("Expected article migration");
    expect(migrated.analysis.sourcesAndVoices[0]).toMatchObject({ displayName: "Jane Smith", contributionSummary: "Stated that the plan would reduce travel times." });
  });
});

describe("AI settings migration", () => {
  it("preserves a saved Claude Code provider selection", async () => {
    const get = vi.fn().mockResolvedValue({ "ellipsis.aiSettings": { enabled: true, provider: "claude", connectionVerifiedAt: "2026-01-01" } });
    vi.stubGlobal("chrome", { storage: { local: { get, set: vi.fn() } } });

    await expect(getAiSettings()).resolves.toMatchObject({ enabled: true, provider: "claude" });
  });
});

describe("Unframed connection and article sync settings", () => {
  it("defaults to disconnected with sync off", async () => {
    const get = vi.fn().mockResolvedValue({});
    vi.stubGlobal("chrome", { storage: { local: { get, set: vi.fn() } } });

    await expect(getUnframedConnection()).resolves.toEqual({ token: null, connectedAt: null });
    await expect(getArticleSyncSettings()).resolves.toEqual({ enabled: false, consentedAt: null });
  });

  it("stores a trimmed token with a connected timestamp, and clears both on disconnect", async () => {
    const set = vi.fn();
    vi.stubGlobal("chrome", { storage: { local: { get: vi.fn().mockResolvedValue({}), set } } });

    const connected = await saveUnframedToken("  ellu_abc123  ");
    expect(connected.token).toBe("ellu_abc123");
    expect(connected.connectedAt).not.toBeNull();

    const disconnected = await saveUnframedToken(null);
    expect(disconnected).toEqual({ token: null, connectedAt: null });
  });
});
