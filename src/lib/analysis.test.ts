import { describe, expect, it } from "vitest";
import { analyzePage, classifyPastedText } from "./analysis";
import type { AnalysisFinding, ExtractedPage } from "../types";

function page(overrides: Partial<ExtractedPage>): ExtractedPage {
  return {
    title: "Test source",
    url: "https://example.com/story",
    sourceName: "Example",
    author: "",
    publishedAt: "",
    text: "",
    contentType: "article",
    links: [],
    ...overrides
  };
}

function findingIds(findings: AnalysisFinding[]) {
  return findings.flatMap((finding) => finding.evidenceIds);
}

describe("article analysis", () => {
  it("recognizes attributed names without treating a negated group mention as an included perspective", () => {
    const analysis = analyzePage(
      page({
        text:
          "Officials announced a transit proposal that would add bus lanes downtown. According to Jordan Lee, the proposal still lacks a detailed funding plan. Critics said parking could be reduced, but the article did not quote any business owners directly. Residents will be invited to a hearing before the city council votes next month."
      })
    );

    expect(analysis.contentType).toBe("article");
    if (analysis.contentType !== "article") return;
    expect(analysis.quotedPeopleOrGroups.map((item) => item.text)).toContain("Jordan Lee");
    expect(analysis.includedPerspectives.map((item) => item.text).join(" ")).not.toMatch(/business perspective/i);
    expect(analysis.confidenceScore).toBeLessThan(75);
  });

  it("links every displayed article finding to a known evidence item", () => {
    const analysis = analyzePage(
      page({
        text:
          "The mayor described the situation as a crisis and proposed a new housing rule. According to Jordan Lee, the proposal could help renters. Critics argued that the rule could increase costs. The council will hold a hearing before voting on the proposal."
      })
    );
    if (analysis.contentType !== "article") throw new Error("Expected article analysis");

    const knownIds = new Set(analysis.evidence.map((item) => item.id));
    const ids = [
      ...analysis.summaryEvidenceIds,
      ...findingIds([analysis.mainIssue]),
      ...findingIds(analysis.framingNotes),
      ...findingIds(analysis.loadedLanguageExamples),
      ...findingIds(analysis.quotedPeopleOrGroups),
      ...findingIds(analysis.includedPerspectives),
      ...findingIds(analysis.missingPerspectives)
    ];
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => knownIds.has(id))).toBe(true);
  });
});

describe("bill analysis", () => {
  it("keeps organization names intact and avoids groups that are only mentioned", () => {
    const analysis = analyzePage(
      page({
        contentType: "bill",
        text:
          "H.R. 123. A bill to establish a grant program for public schools. SECTION 1. The Department of Education shall establish grants for states and schools to purchase classroom equipment. Families, students, workers, and small businesses are mentioned in a study requirement, but the text does not provide them benefits. The National School Association supports the bill. The Office of Budget Review opposed an earlier version. Final funding levels would be determined later."
      })
    );

    expect(analysis.contentType).toBe("bill");
    if (analysis.contentType !== "bill") return;
    expect(analysis.sourcedOpponents.map((item) => item.text)).toContain("Office of Budget Review");
    expect(analysis.sourcedSupporters.map((item) => item.text)).toContain("National School Association");
    const groups = analysis.affectedGroups.map((item) => item.text.toLowerCase()).join(" ");
    expect(groups).toContain("states");
    expect(groups).toContain("schools");
    expect(groups).not.toContain("students");
    expect(groups).not.toContain("workers");
    expect(analysis.mainIssue.evidenceIds.length).toBeGreaterThan(0);
  });
});

describe("classification", () => {
  it("detects bill text and leaves very short fragments unknown", () => {
    expect(classifyPastedText("H.R. 7. A bill to establish a program. SECTION 1. The Act shall amend existing law.")).toBe("bill");
    expect(classifyPastedText("A short fragment.")).toBe("unknown");
  });
});
