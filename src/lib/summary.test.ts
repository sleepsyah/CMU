import { describe, expect, it } from "vitest";
import { cleanOverallBiasSummary } from "./summary";

describe("overall bias summary cleanup", () => {
  const firstSentence = "The article frames Burnham as a hopeful but untested successor, emphasizing renewal alongside Labour’s policy strains.";
  const fallback = "The local review found limited evidence of strongly evaluative framing.";

  it("preserves a complete two-sentence explanation without clipping it", () => {
    const value = `${firstSentence} Its attributed and procedural language limits the force of that framing.`;
    expect(cleanOverallBiasSummary(value)).toBe(value);
  });

  it("drops an incomplete final sentence instead of displaying a cutoff", () => {
    expect(cleanOverallBiasSummary(`${firstSentence} Its strongest language often comes through attribution, so the news report is pointed`)).toBe(firstSentence);
  });

  it("removes corrupted terminal script and orphan tokens", () => {
    expect(cleanOverallBiasSummary(`${firstSentence} Its bias is limited by procedural context, though evaluative words occasionally n等`)).toBe(firstSentence);
    expect(cleanOverallBiasSummary(`${firstSentence} 3`)).toBe(firstSentence);
  });

  it("uses a complete fallback when the generated explanation has no complete sentence", () => {
    expect(cleanOverallBiasSummary("The article frames the dispute through", fallback)).toBe(fallback);
  });
});
