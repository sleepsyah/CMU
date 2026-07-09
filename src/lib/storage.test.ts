import { describe, expect, it } from "vitest";
import { migrateSavedAnalysis } from "./storage";
import type { SavedAnalysis } from "../types";

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
  });
});
