import { describe, expect, it } from "vitest";
import { analyzePage, classifyPastedText, cleanDisplayTitle, cleanReadableSourceText, keyFindingsFor } from "./analysis";
import { longLiveBlogFixture } from "./fixtures/sources-and-voices-excerpts";
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
  it("recognizes explicit attribution without inventing voices from nearby mentions", () => {
    const analysis = analyzePage(
      page({
        text:
          "Officials announced a transit proposal that would add bus lanes downtown. According to Jordan Lee, the proposal still lacks a detailed funding plan. Critics said parking could be reduced, but the article did not quote any business owners directly. Residents will be invited to a hearing before the city council votes next month."
      })
    );

    expect(analysis.contentType).toBe("article");
    if (analysis.contentType !== "article") return;
    expect(analysis.sourcesAndVoices.map((item) => item.displayName)).toContain("Jordan Lee");
    expect(analysis.sourcesAndVoices.map((item) => item.displayName).join(" ")).not.toMatch(/business owners/i);
    expect(analysis.confidenceScore).toBeLessThan(75);
  });

  it("does not treat CBS-style weekday attribution modifiers as sources", () => {
    const analysis = analyzePage(
      page({
        text: [
          "The United Arab Emirates Ministry of Defense said Monday that Iranian cruise missiles hit two oil tankers in the Strait of Hormuz.",
          "A government spokesperson said Tuesday that officials were monitoring the attacks and would publish another statement.",
          "\"We remain concerned about commercial shipping,\" said Jane Smith after the briefing."
        ].join(" ")
      })
    );
    if (analysis.contentType !== "article") throw new Error("Expected article analysis");

    const sources = analysis.sourcesAndVoices.map((item) => item.displayName);
    expect(sources).toContain("Jane Smith");
    expect(sources).not.toEqual(expect.arrayContaining(["Monday", "Tuesday"]));
  });

  it("passes complete-document canonical sources and coverage metadata to the sidebar analysis", () => {
    const text = longLiveBlogFixture();
    const analysis = analyzePage(page({ text }));
    if (analysis.contentType !== "article") throw new Error("Expected article analysis");

    expect(analysis.sourcesAndVoices.map((source) => source.displayName)).toEqual(expect.arrayContaining([
      "U.S. Central Command (CENTCOM)",
      "Maritime Safety Board"
    ]));
    expect(analysis.sourceCoverage.processedCharacterCount).toBe(text.length);
    expect(analysis.sourceCoverage.truncated).toBe(false);
    expect(analysis.sourceEvents.at(-1)?.blockId).toMatch(/^block-/);
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
      ...findingIds(analysis.loadedLanguageExamples)
    ];
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => knownIds.has(id))).toBe(true);
  });

  it("builds a concise summary from representative details instead of copying the opening paragraph", () => {
    const opening =
      "The governor directed the transportation commissioner to oversee an investigation into repeated rail delays, according to three officials familiar with the decision.";
    const analysis = analyzePage(
      page({
        title: "Governor orders investigation into rail delays",
        text: [
          opening,
          "The review began after signal failures stranded thousands of riders during the morning commute.",
          "Transit records show that maintenance vacancies doubled over the previous year and delayed scheduled inspections.",
          "The agency said it will publish preliminary findings next month and has not yet estimated the cost of repairs."
        ].join(" ")
      })
    );
    if (analysis.contentType !== "article") throw new Error("Expected article analysis");

    expect(analysis.summary).toMatch(/^The article reports that /);
    expect(analysis.summary).not.toBe(`${opening} The review began after signal failures stranded thousands of riders during the morning commute.`);
    expect(analysis.summary).not.toContain("...");
    expect(analysis.summaryEvidenceIds).toHaveLength(2);
    expect(analysis.summaryEvidenceIds.every((id) => analysis.evidence.some((item) => item.id === id))).toBe(true);
  });

  it("keeps source extraction separate from genre classification", () => {
    const analysis = analyzePage(
      page({
        title: "Annual transit data report",
        text:
          "The annual report analyzes transit delays using a sample of 4,200 trips and explains its methodology and limitations. Independent university researchers said the findings were consistent with earlier studies. The report describes longer delays on two bus routes and recommends collecting another year of data. City officials will review the results next month."
      })
    );
    if (analysis.contentType !== "article") throw new Error("Expected article analysis");

    expect(analysis.genre).toBe("data_report");
    expect(analysis.sourcesAndVoices.map((item) => item.displayName).join(" ")).toMatch(/researchers/i);
    expect("missingPerspectives" in analysis).toBe(false);
  });

  it("limits the primary reading flow to three findings", () => {
    const analysis = analyzePage(
      page({
        text:
          "The mayor blasted the radical plan as a disastrous betrayal and called the situation a crisis. According to Jordan Lee, the proposal could help renters. Critics argued that it could increase costs. Residents said the council should release the funding analysis before voting."
      })
    );

    expect(keyFindingsFor(analysis).length).toBeLessThanOrEqual(3);
  });

  it("builds a multi-label framing profile with source-linked evidence", () => {
    const analysis = analyzePage(
      page({
        text:
          "The city council approved a housing policy after debating costs, funding, and the supply of available apartments. Tenant advocates said the plan would improve quality of life, while budget officials questioned whether the city had enough staff and resources to implement it. A court challenge could determine whether the rule is lawful."
      })
    );
    if (analysis.contentType !== "article") throw new Error("Expected article analysis");

    const labels = analysis.framingProfile.dominantFrames.map((frame) => frame.label);
    expect(labels).toContain("Economic");
    expect(labels).toContain("Capacity and resources");
    const knownIds = new Set(analysis.evidence.map((item) => item.id));
    expect(analysis.framingProfile.dominantFrames.flatMap((frame) => frame.evidenceIds).every((id) => knownIds.has(id))).toBe(true);
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

  it("removes serialized Congress.gov fields from titles and displayed analysis text", () => {
    const rawTitle = "S.629 - 119th Congress (2025-2026): Emergency Conservation Program Improvement Act of 2025 | Congress.gov";
    const rawText = [
      "S.629 - Emergency Conservation Program Improvement Act of 2025 119th Congress (2025-2026) | Get alerts IntroducedArray ( [actionDate] => 2025-02-19 [displayText] => Introduced in Senate )",
      "The bill would improve the Emergency Conservation Program for farmers affected by natural disasters.",
      "The proposal would direct the Department of Agriculture to update program rules and implementation guidance."
    ].join("\n\n");

    expect(cleanDisplayTitle(rawTitle)).toBe("S.629 - Emergency Conservation Program Improvement Act of 2025");
    expect(cleanReadableSourceText(rawText)).not.toMatch(/Array|\[actionDate\]|=>/);

    const analysis = analyzePage(page({
      title: rawTitle,
      url: "https://www.congress.gov/bill/119th-congress/senate-bill/629",
      contentType: "bill",
      text: rawText
    }));

    expect(analysis.pageTitle).toBe("S.629 - Emergency Conservation Program Improvement Act of 2025");
    expect(analysis.summary).toContain("farmers affected by natural disasters");
    expect(analysis.summary).not.toMatch(/Array|\[actionDate\]|=>|Get alerts/);
    expect(analysis.evidence.map((item) => item.supportingText).join(" ")).not.toMatch(/Array|\[actionDate\]|=>/);
  });
});

describe("classification", () => {
  it("detects bill text and leaves very short fragments unknown", () => {
    expect(classifyPastedText("H.R. 7. A bill to establish a program. SECTION 1. The Act shall amend existing law.")).toBe("bill");
    expect(classifyPastedText("A short fragment.")).toBe("unknown");
  });
});
