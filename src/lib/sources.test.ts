import { describe, expect, it } from "vitest";
import { longLiveBlogFixture, sourceExcerpts } from "./fixtures/sources-and-voices-excerpts";
import { extractSourcesAndVoices, sourceRoleLabel, validateSourceDisplayName } from "./sources";

describe("Sources and Voices extraction", () => {
  it("includes only explicitly attributed sources and keeps exact evidence", () => {
    const text = "The transit proposal was discussed in Pittsburgh on Tuesday. City Council chair Jane Smith said the plan would reduce travel times.";
    const result = extractSourcesAndVoices(text);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      displayName: "Jane Smith",
      entityType: "person",
      contributionSummary: "Stated that the plan would reduce travel times."
    });
    expect(result.sources[0].evidence[0].evidenceText).toBe("City Council chair Jane Smith said the plan would reduce travel times.");
    expect(result.sources.map((source) => source.displayName)).not.toEqual(expect.arrayContaining(["Pittsburgh", "Tuesday"]));
  });

  it("distinguishes a direct quote from a quoted fragment inside a paraphrase", () => {
    const paraphrase = extractSourcesAndVoices(sourceExcerpts.paraphraseWithQuotedFragment).sources[0];
    const direct = extractSourcesAndVoices(sourceExcerpts.actualDirectQuote).sources[0];
    expect(paraphrase.displayName).toBe("Indian foreign ministry");
    expect(paraphrase.evidence[0]).toMatchObject({ attributionType: "paraphrased", quotedText: "a strong protest" });
    expect(sourceRoleLabel(paraphrase)).toBe("Paraphrased by the article");
    expect(direct.evidence[0]).toMatchObject({ attributionType: "direct_quote", quotedText: "We have registered a strong protest." });
    expect(sourceRoleLabel(direct)).toBe("Quoted directly");
  });

  it("uses the fullest clear person name once and omits title-only aliases", () => {
    const result = extractSourcesAndVoices("President Donald Trump said the plan would change. President Trump later stated that details would follow. Trump told reporters the same plan remained under review.");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].displayName).toBe("Donald Trump");
    expect(result.sources[0].mentionCount).toBe(3);
  });

  it("merges title, honorific, and surname aliases when a role anchor is unambiguous", () => {
    const result = extractSourcesAndVoices("President Trump said the plan would change. Mr. Trump later stated that details would follow. Trump told reporters the same plan remained under review. The president said the review would finish soon.");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].displayName).toBe("President Trump");
    expect(result.sources[0].mentionCount).toBe(4);
  });

  it("omits pronouns and unanchored titles instead of displaying partial voices", () => {
    const result = extractSourcesAndVoices("It said service would resume. The president said details would follow.");
    expect(result.sources).toEqual([]);
  });

  it("keeps a person separate from the institution they lead", () => {
    const result = extractSourcesAndVoices("Gen. Brad Cooper, commander of U.S. Central Command, said operations would continue. U.S. Central Command said its forces redirected vessels.");
    expect(result.sources.map((source) => source.displayName)).toEqual(expect.arrayContaining(["Brad Cooper", "U.S. Central Command"]));
    expect(result.sources).toHaveLength(2);
  });

  it("uses the strongest attributed passage for both the contribution and first evidence", () => {
    const result = extractSourcesAndVoices("Agency Alpha said in a statement. \"We restored service to three neighborhoods,\" Agency Alpha said later.");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].contributionSummary).toContain("restored service to three neighborhoods");
    expect(result.sources[0].evidence[0].evidenceText).toBe("\"We restored service to three neighborhoods,\" Agency Alpha said later.");
  });

  it("omits an attribution that has no substantive contribution", () => {
    expect(extractSourcesAndVoices("Scott Bessent said in a statement.").sources).toEqual([]);
  });

  it("keeps a reporting channel attached to the original source instead of showing it separately", () => {
    const result = extractSourcesAndVoices(sourceExcerpts.cbsInvertedVia);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].displayName).toBe("Hormozgan governor's office");
    expect(result.sources[0].reportedVia).toEqual(["IRIB"]);
    expect(result.sources.map((source) => source.displayName)).not.toContain("IRIB");
  });

  it("includes clearly attributed anonymous groups", () => {
    const result = extractSourcesAndVoices("Two U.S. officials told CBS News that the talks would resume on Friday.");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({ displayName: "Two U.S. officials", entityType: "anonymous_source" });
  });

  it("includes an explicitly attributed report as a document source", () => {
    const result = extractSourcesAndVoices("The University Housing Affordability Report found that average rents rose by eight percent.");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].entityType).toBe("document");
    expect(sourceRoleLabel(result.sources[0])).toBe("Document or data source");
  });

  it("omits mentions, passive attribution, and attributive reporting words", () => {
    const result = extractSourcesAndVoices([
      "The U.S. did not immediately claim the attacks.",
      sourceExcerpts.unresolvedPassive,
      sourceExcerpts.cbsAttributiveReportingVerb
    ].join(" "));
    expect(result.sources).toEqual([]);
  });

  it("binds a reporting verb to its local subordinate-clause subject", () => {
    const result = extractSourcesAndVoices("In December, Alina Habba resigned as the top federal prosecutor for New Jersey after an appeals court said she had been serving in the post unlawfully.");
    expect(result.sources.map((source) => source.displayName)).not.toContain("Alina Habba");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      displayName: "an appeals court",
      contributionSummary: "Stated that she had been serving in the post unlawfully."
    });
  });

  it("does not mistake a non-finite modifier inside a relative clause for a source", () => {
    const result = extractSourcesAndVoices("Rogoff, who spent 20 years as a state prosecutor and six as a federal prosecutor before becoming a state judge, said he knew the administration might fire him immediately.");
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      displayName: "Rogoff",
      contributionSummary: "Stated that he knew the administration might fire him immediately."
    });
    expect(result.sources.map((source) => source.displayName)).not.toContain("becoming a state judge");
  });

  it("ignores non-finite boundary phrases while retaining the sentence subject", () => {
    const results = [
      extractSourcesAndVoices("Jordan Lee, after serving as counsel, said the agency should publish its records."),
      extractSourcesAndVoices("Before becoming governor, Jane Smith said she had worked as an attorney.")
    ];
    expect(results[0].sources[0]?.displayName).toBe("Jordan Lee");
    expect(results[1].sources[0]?.displayName).toBe("Jane Smith");
  });

  it("does not promote a main-clause subject when a nested source reports the claim", () => {
    const result = extractSourcesAndVoices([
      "Mayor Smith left the meeting after Jordan Lee said the proposal lacked enough votes.",
      "The agency changed its rules because auditors reported that several records were incomplete.",
      "Jordan Lee endorsed the first proposal, but the committee said a second vote was necessary."
    ].join(" "));
    expect(result.sources.map((source) => source.displayName)).toEqual(expect.arrayContaining(["Jordan Lee", "auditors", "committee"]));
    expect(result.sources.map((source) => source.displayName)).not.toEqual(expect.arrayContaining(["Mayor Smith", "The agency"]));
  });

  it("rejects clauses masquerading as source names while preserving explicit attribution", () => {
    expect(validateSourceDisplayName("Alina Habba resigned as the top federal prosecutor", "Alina Habba resigned after a court said the appointment was unlawful.").name).toBeNull();
    expect(extractSourcesAndVoices("Alina Habba said the appointment process was lawful.").sources[0]?.displayName).toBe("Alina Habba");
    expect(extractSourcesAndVoices("Local housing advocates said the proposal would reduce rents.").sources[0]?.displayName).toBe("Local housing advocates");
  });

  it("preserves a supported long institutional name", () => {
    const source = extractSourcesAndVoices(sourceExcerpts.longInstitutionName).sources[0];
    expect(source.displayName).toBe("India’s Ministry of External Affairs");
  });

  it("limits the list to eight substantive explicit sources", () => {
    const text = Array.from({ length: 12 }, (_, index) => `Agency ${index + 1} said that its response team completed review number ${index + 1}.`).join(" ");
    const result = extractSourcesAndVoices(text);
    expect(result.sources).toHaveLength(8);
    expect(result.sources.every((source) => source.evidence.length > 0 && source.contributionSummary.length > 0)).toBe(true);
  });

  it("returns the explicit empty state data instead of inventing a voice", () => {
    const result = extractSourcesAndVoices("The storm crossed the coast on Tuesday. Roads remained closed throughout the city.");
    expect(result.sources).toEqual([]);
    expect(result.sourceSummary).toBe("");
  });

  it("processes the full live blog without truncation", () => {
    const text = longLiveBlogFixture();
    const result = extractSourcesAndVoices(text);
    expect(result.sources.map((source) => source.displayName)).toEqual(expect.arrayContaining(["U.S. Central Command (CENTCOM)", "Maritime Safety Board"]));
    expect(result.coverage.totalCharacterCount).toBe(text.length);
    expect(result.coverage.truncated).toBe(false);
  });
});
