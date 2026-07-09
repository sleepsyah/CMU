import type {
  Analysis,
  AnalysisFinding,
  ArticleAnalysis,
  BillAnalysis,
  ConfidenceLabel,
  ContentType,
  EvidenceItem,
  EvidenceKind,
  ExtractedPage
} from "../types";

const LOADED_TERMS = [
  "radical",
  "extreme",
  "shocking",
  "disastrous",
  "devastating",
  "corrupt",
  "dangerous",
  "outrage",
  "crisis",
  "catastrophe",
  "betrayal",
  "reckless",
  "weaponized",
  "secretive",
  "slam",
  "blasted"
];

const CONGRESS_GLOSSARY_URL = "https://www.congress.gov/help/legislative-glossary";
const TERM_GLOSSARY: Record<string, string> = {
  appropriation: "Government authority to spend money for a stated purpose.",
  amendment: "A proposed change to a bill or other pending text.",
  authorization: "Legal authority for a program or activity, often separate from its funding.",
  committee: "A group of lawmakers that examines legislation and other matters.",
  fiscal: "Related to government revenue, spending, or budgets.",
  regulation: "A rule issued by an agency to carry out a law.",
  subsidy: "Government support, such as a payment or tax benefit, for an activity or group.",
  eligibility: "The conditions a person or organization must meet to qualify."
};

const GENERIC_SOURCE_NAMES = /^(supporters|opponents|critics|advocates|officials|experts|researchers|lawmakers|people|residents|students|workers)$/i;
const NAME_PART = "[A-Z][A-Za-z&.'’–-]+";
const NAMED_ACTOR = `${NAME_PART}(?:\\s+(?:(?:of|the|and|for|in|on)\\s+)?${NAME_PART}){0,6}`;

function makeId(prefix: string) {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

function normalizeWhitespace(text: string) {
  return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function splitSentences(text: string) {
  return normalizeWhitespace(text)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 24)
    .slice(0, 120);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function confidenceLabel(score: number): ConfidenceLabel {
  if (score >= 75) return "High";
  if (score >= 50) return "Medium";
  return "Low";
}

function finding(text: string, evidenceIds: string[], confidenceScore: number): AnalysisFinding {
  return { text, evidenceIds, confidenceScore, confidenceLabel: confidenceLabel(confidenceScore) };
}

function sourceUrl(page: ExtractedPage) {
  return /^https?:\/\//.test(page.url) ? page.url : null;
}

function sourceLabel(page: ExtractedPage) {
  return sourceUrl(page) ? page.sourceName || "Active page" : "Pasted source text";
}

function addEvidence(
  items: EvidenceItem[],
  page: ExtractedPage,
  input: {
    claim: string;
    supportingText: string;
    explanation: string;
    confidenceScore: number;
    kind?: EvidenceKind;
    sourceUrl?: string | null;
    sourceLabel?: string;
  }
) {
  const id = makeId("ev");
  items.push({
    id,
    claim: input.claim,
    supportingText: input.supportingText,
    sourceUrl: input.sourceUrl === undefined ? sourceUrl(page) : input.sourceUrl,
    sourceLabel: input.sourceLabel || sourceLabel(page),
    kind: input.kind || "source_text",
    explanation: input.explanation,
    confidenceScore: input.confidenceScore,
    confidenceLabel: confidenceLabel(input.confidenceScore)
  });
  return id;
}

function addAnalysisNote(items: EvidenceItem[], page: ExtractedPage, claim: string, note: string, explanation: string) {
  return addEvidence(items, page, {
    claim,
    supportingText: note,
    explanation,
    confidenceScore: 35,
    kind: "analysis_note",
    sourceUrl: null,
    sourceLabel: "unframed analysis note"
  });
}

function firstUsefulSentences(sentences: string[], count: number) {
  return sentences.filter((sentence) => !/cookie|subscribe|advertisement|newsletter/i.test(sentence)).slice(0, count);
}

function confidenceFor(page: ExtractedPage, evidenceItems: EvidenceItem[]) {
  const directEvidence = evidenceItems.filter((item) => item.kind === "source_text").length;
  const analysisNotes = evidenceItems.filter((item) => item.kind === "analysis_note").length;
  let score = 34;
  if (page.text.length > 1200) score += 8;
  if (page.text.length > 4000) score += 6;
  if (page.author) score += 3;
  if (page.publishedAt) score += 3;
  if (sourceUrl(page)) score += 4;
  score += Math.min(directEvidence * 2, 14);
  score -= Math.min(analysisNotes * 2, 10);
  if (page.contentType === "unknown") score -= 8;

  // Local heuristics are useful reading aids, not validated factual analysis.
  return clamp(score, 25, 74);
}

function summaryEvidence(page: ExtractedPage, evidenceItems: EvidenceItem[], sentences: string[]) {
  const summarySentences = firstUsefulSentences(sentences, 2);
  if (!summarySentences.length) return { summary: "The extracted text was not complete enough to summarize.", evidenceIds: [] };
  const evidenceIds = summarySentences.map((sentence) =>
    addEvidence(evidenceItems, page, {
      claim: "Source passage used in the short summary.",
      supportingText: sentence,
      explanation: "This passage was selected from the opening substantive source text. It is not independently verified.",
      confidenceScore: 62
    })
  );
  return { summary: summarySentences.join(" "), evidenceIds };
}

function mainIssueFinding(page: ExtractedPage, evidenceItems: EvidenceItem[], sentences: string[]) {
  const sentence = firstUsefulSentences(sentences, 1)[0];
  if (!sentence) {
    const noteId = addAnalysisNote(
      evidenceItems,
      page,
      "Main issue could not be identified.",
      "No substantive sentence was detected in the extracted text.",
      "The result is intentionally left uncertain instead of inferring a topic."
    );
    return finding("The main issue is unclear from the extracted text.", [noteId], 30);
  }
  const evidenceId = addEvidence(evidenceItems, page, {
    claim: "Possible main issue.",
    supportingText: sentence,
    explanation: "The opening substantive passage appears to introduce the central topic; verify it against the full source.",
    confidenceScore: 58
  });
  return finding(sentence.slice(0, 180), [evidenceId], 58);
}

function loadedLanguageFindings(page: ExtractedPage, evidenceItems: EvidenceItem[], sentences: string[]) {
  const results: ArticleAnalysis["loadedLanguageExamples"] = [];
  for (const term of LOADED_TERMS) {
    const matcher = new RegExp(`\\b${term}\\b`, "i");
    const context = sentences.find((sentence) => matcher.test(sentence));
    if (!context) continue;
    const evidenceId = addEvidence(evidenceItems, page, {
      claim: `Potentially loaded wording: “${term}”.`,
      supportingText: context,
      explanation: "The word can carry emotional weight, but its use may still be accurate in context. Treat this as a prompt to inspect the wording, not a bias verdict.",
      confidenceScore: 52
    });
    results.push({ ...finding(`“${term}” may add emotional emphasis.`, [evidenceId], 52), phrase: term, context });
    if (results.length >= 5) break;
  }
  return results;
}

function quotedSources(text: string) {
  const sentences = splitSentences(text);
  const values = new Map<string, string>();
  const patterns = [
    new RegExp(`(?:According to|according to)\\s+(?:the\\s+)?(${NAMED_ACTOR})`, "g"),
    new RegExp(`(${NAMED_ACTOR})\\s+(?:said|says|told|wrote|argued)\\b`, "g"),
    new RegExp(`(?:said|says|told|wrote|argued)\\s+(${NAMED_ACTOR})`, "g")
  ];

  for (const sentence of sentences) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of sentence.matchAll(pattern)) {
        const name = normalizeWhitespace(match[1] || "").replace(/^The\s+/i, "");
        if (name.length > 2 && name.length < 80 && !GENERIC_SOURCE_NAMES.test(name)) values.set(name, sentence);
        if (values.size >= 10) break;
      }
    }
  }
  return Array.from(values, ([name, sentence]) => ({ name, sentence }));
}

function perspectiveFindings(page: ExtractedPage, evidenceItems: EvidenceItem[], sentences: string[], quoted: ReturnType<typeof quotedSources>) {
  const results: AnalysisFinding[] = [];
  for (const source of quoted) {
    const evidenceId = addEvidence(evidenceItems, page, {
      claim: `Attributed source identified: ${source.name}.`,
      supportingText: source.sentence,
      explanation: "The source is named in an attribution pattern. This does not establish the source's viewpoint or expertise.",
      confidenceScore: 66
    });
    results.push(finding(`Attributed perspective from ${source.name}.`, [evidenceId], 66));
  }

  const viewpointPatterns = [
    { pattern: /\b(supporters|backers|advocates)\b/i, text: "A supportive viewpoint is described." },
    { pattern: /\b(critics|opponents)\b/i, text: "A critical or opposing viewpoint is described." }
  ];
  for (const item of viewpointPatterns) {
    const sentence = sentences.find((candidate) => item.pattern.test(candidate));
    if (!sentence) continue;
    const evidenceId = addEvidence(evidenceItems, page, {
      claim: item.text,
      supportingText: sentence,
      explanation: "The source text explicitly labels this viewpoint, although it may not name or quote a specific person.",
      confidenceScore: 58
    });
    results.push(finding(item.text, [evidenceId], 58));
  }
  return results.slice(0, 8);
}

function missingPerspectiveFindings(page: ExtractedPage, evidenceItems: EvidenceItem[], included: AnalysisFinding[], quoted: ReturnType<typeof quotedSources>) {
  const joined = included.map((item) => item.text).join(" ").toLowerCase();
  const detected = quoted.length ? quoted.map((source) => source.name).join(", ") : "No named attributed sources detected";
  const suggestions: string[] = [];
  if (!joined.includes("supportive")) suggestions.push("Check whether a clearly attributed supportive viewpoint is missing.");
  if (!joined.includes("critical") && !joined.includes("opposing")) suggestions.push("Check whether a clearly attributed critical viewpoint is missing.");
  if (!/expert|researcher|study/i.test(page.text)) suggestions.push("Consider whether independent expert context would clarify the issue.");

  return suggestions.slice(0, 3).map((text) => {
    const noteId = addAnalysisNote(
      evidenceItems,
      page,
      "Perspective to check, not a confirmed omission.",
      `Attributed sources detected by the local parser: ${detected}.`,
      "Absence is difficult to prove from extracted text, so this is presented as a review question rather than a factual claim."
    );
    return finding(text, [noteId], 35);
  });
}

function framingFindings(
  page: ExtractedPage,
  evidenceItems: EvidenceItem[],
  loaded: ArticleAnalysis["loadedLanguageExamples"],
  included: AnalysisFinding[],
  quoted: ReturnType<typeof quotedSources>
) {
  const results: AnalysisFinding[] = [];
  if (loaded.length) {
    results.push(
      finding(
        "Some wording may encourage an emotional reading; inspect the cited passages in context.",
        loaded.flatMap((item) => item.evidenceIds),
        50
      )
    );
  }
  if (included.some((item) => /supportive/.test(item.text)) && included.some((item) => /critical|opposing/.test(item.text))) {
    results.push(
      finding(
        "The extracted text organizes part of the issue around supportive and critical reactions.",
        included.flatMap((item) => item.evidenceIds),
        56
      )
    );
  }
  if (quoted.length <= 1) {
    const noteId = addAnalysisNote(
      evidenceItems,
      page,
      "Narrow attributed-source base in extracted text.",
      `${quoted.length} named attributed source${quoted.length === 1 ? " was" : "s were"} detected by the local parser.`,
      "Extraction or attribution patterns can miss sources, so this is a low-confidence review prompt."
    );
    results.push(finding("The extracted text may rely on a narrow attributed-source base.", [noteId], 38));
  }
  if (!results.length) {
    const noteId = addAnalysisNote(
      evidenceItems,
      page,
      "No strong framing signal detected.",
      "The local parser did not detect its limited set of framing signals.",
      "This is not evidence that the article is neutral."
    );
    results.push(finding("No strong framing signal was detected; this is not a neutrality rating.", [noteId], 35));
  }
  return results;
}

function analyzeArticle(page: ExtractedPage): ArticleAnalysis {
  const sentences = splitSentences(page.text);
  const evidenceItems: EvidenceItem[] = [];
  const summary = summaryEvidence(page, evidenceItems, sentences);
  const mainIssue = mainIssueFinding(page, evidenceItems, sentences);
  const loaded = loadedLanguageFindings(page, evidenceItems, sentences);
  const quoted = quotedSources(page.text);
  const included = perspectiveFindings(page, evidenceItems, sentences, quoted);
  const missing = missingPerspectiveFindings(page, evidenceItems, included, quoted);
  const framingNotes = framingFindings(page, evidenceItems, loaded, included, quoted);
  const quotedFindings = quoted.map((source) => {
    const existing = evidenceItems.find((item) => item.claim.includes(source.name));
    return finding(source.name, existing ? [existing.id] : [], 66);
  });
  const displayedIncluded = included.length
    ? included
    : [
        finding(
          "No named or explicitly labeled perspectives were reliably detected.",
          [
            addAnalysisNote(
              evidenceItems,
              page,
              "No perspectives reliably detected.",
              "The local attribution parser returned no named or explicitly labeled viewpoints.",
              "This may reflect extraction limits rather than the source itself."
            )
          ],
          32
        )
      ];
  const confidenceScore = confidenceFor(page, evidenceItems);

  return {
    id: makeId("analysis"),
    url: page.url,
    pageTitle: page.title,
    sourceName: page.sourceName,
    author: page.author,
    publishedAt: page.publishedAt,
    contentType: "article",
    summary: summary.summary,
    summaryEvidenceIds: summary.evidenceIds,
    confidenceScore,
    confidenceReason: "This local heuristic review is limited to extracted source text. Findings are prompts for closer reading, not verified bias judgments.",
    createdAt: new Date().toISOString(),
    evidence: evidenceItems,
    mainIssue,
    framingNotes,
    loadedLanguageExamples: loaded,
    quotedPeopleOrGroups: quotedFindings,
    includedPerspectives: displayedIncluded,
    missingPerspectives: missing
  };
}

function billNumberFrom(page: ExtractedPage) {
  const urlMatch = page.url.match(/\/bill\/\d+(?:st|nd|rd|th)-congress\/([^/]+)\/(\d+)/i);
  if (urlMatch) return `${urlMatch[1].replace("-", " ").toUpperCase()} ${urlMatch[2]}`;
  return page.text.match(/\b(H\.R\.|S\.|H\.Res\.|S\.Res\.)\s?\d+\b/i)?.[0] || "Bill number not found";
}

function looksLikeBillText(text: string, url = "") {
  const hasCongressUrl = /congress\.gov\/bill\/\d+/i.test(url);
  const hasBillIdentifier = /\b(H\.R\.|S\.|H\.Res\.|S\.Res\.)\s?\d+\b/i.test(text);
  const hasBillLanguage =
    /\bA bill to\b/i.test(text) ||
    /\bBe it enacted by the Senate and House\b/i.test(text) ||
    (/\bSECTION\s+1\b/i.test(text) && /\b(amend|authorize|require|prohibit|appropriate|establish)\b/i.test(text));
  return hasCongressUrl || (hasBillIdentifier && hasBillLanguage);
}

function proposedChangeFindings(page: ExtractedPage, evidenceItems: EvidenceItem[], sentences: string[]) {
  return sentences
    .filter((sentence) => /\b(amend|establish|require|prohibit|authorize|appropriate|direct|create|increase|reduce|repeal)\b/i.test(sentence))
    .slice(0, 5)
    .map((sentence) => {
      const evidenceId = addEvidence(evidenceItems, page, {
        claim: "Possible proposed change.",
        supportingText: sentence,
        explanation: "A legislative action verb appears in this passage. Read the surrounding section to confirm its scope and conditions.",
        confidenceScore: 58
      });
      return finding(sentence, [evidenceId], 58);
    });
}

function affectedGroupFindings(page: ExtractedPage, evidenceItems: EvidenceItem[], sentences: string[]) {
  const groups = ["students", "workers", "families", "veterans", "small businesses", "agencies", "states", "schools", "patients", "consumers", "employers", "immigrants", "farmers", "taxpayers"];
  const action = /\b(receive|receives|provide|provides|grant|grants|eligible|prohibit|prohibits|require|requires|tax|taxes|fund|funds|regulate|regulates|benefit|benefits|pay|pays)\b/i;
  const exclusion = /\b(does not|do not|did not|not provide|only mentioned|are mentioned|is mentioned)\b/i;
  const results: AnalysisFinding[] = [];
  for (const group of groups) {
    const sentence = sentences.find(
      (candidate) => new RegExp(`\\b${group}\\b`, "i").test(candidate) && action.test(candidate) && !exclusion.test(candidate)
    );
    if (!sentence) continue;
    const evidenceId = addEvidence(evidenceItems, page, {
      claim: `Potentially affected group named in a provision: ${group}.`,
      supportingText: sentence,
      explanation: "The group appears in the same passage as a legislative action. Actual effects may depend on definitions, implementation, and funding.",
      confidenceScore: 50
    });
    results.push(finding(`${group[0].toUpperCase()}${group.slice(1)} — named near a legislative action; actual impact is uncertain.`, [evidenceId], 50));
  }
  return results.slice(0, 6);
}

function supporterOpponentFindings(page: ExtractedPage, evidenceItems: EvidenceItem[], sentences: string[], mode: "support" | "oppose") {
  const verb = mode === "support" ? "(?:supports|supported|endorses|endorsed|backed|backs)" : "(?:opposes|opposed|criticized|objects|objected)";
  const pattern = new RegExp(`^\\s*(?:The\\s+)?(${NAMED_ACTOR})\\s+${verb}\\b`);
  const values = new Map<string, string>();
  for (const sentence of sentences) {
    const match = sentence.match(pattern);
    const actor = normalizeWhitespace(match?.[1] || "");
    if (actor && !GENERIC_SOURCE_NAMES.test(actor)) values.set(actor, sentence);
    if (values.size >= 5) break;
  }
  return Array.from(values, ([actor, sentence]) => {
    const evidenceId = addEvidence(evidenceItems, page, {
      claim: `${actor} is described as ${mode === "support" ? "supporting" : "opposing"} the bill.`,
      supportingText: sentence,
      explanation: "The extracted source text directly pairs this named actor with a support or opposition verb. This does not independently verify the position.",
      confidenceScore: 64
    });
    return finding(actor, [evidenceId], 64);
  });
}

function unclearImpactFindings(page: ExtractedPage, evidenceItems: EvidenceItem[], sentences: string[]) {
  const passages = sentences.filter((sentence) => /\b(implementation|funding|appropriation|subject to|determined later|agency guidance|effective date)\b/i.test(sentence)).slice(0, 3);
  if (passages.length) {
    return passages.map((sentence) => {
      const evidenceId = addEvidence(evidenceItems, page, {
        claim: "Implementation or impact detail may remain unresolved.",
        supportingText: sentence,
        explanation: "This passage refers to funding, implementation, timing, or later decisions that may affect practical outcomes.",
        confidenceScore: 52
      });
      return finding("Practical effects may depend on the cited funding, implementation, or timing detail.", [evidenceId], 52);
    });
  }
  const noteId = addAnalysisNote(
    evidenceItems,
    page,
    "Implementation impacts remain unverified.",
    "No clear implementation, funding, enforcement, or effective-date passage was detected by the local parser.",
    "The absence of a detected passage does not prove that the bill omits these details."
  );
  return [finding("Implementation and practical effects require review of the complete bill and related materials.", [noteId], 35)];
}

function importantTermFindings(page: ExtractedPage, evidenceItems: EvidenceItem[]) {
  return Object.entries(TERM_GLOSSARY)
    .filter(([term]) => new RegExp(`\\b${term}\\b`, "i").test(page.text))
    .slice(0, 5)
    .map(([term, meaning]) => {
      const evidenceId = addEvidence(evidenceItems, page, {
        claim: `Plain-language definition for “${term}”.`,
        supportingText: meaning,
        explanation: "This definition is outside context from the official Congress.gov legislative glossary; verify how the bill uses the term.",
        confidenceScore: 70,
        kind: "outside_context",
        sourceUrl: CONGRESS_GLOSSARY_URL,
        sourceLabel: "Congress.gov legislative glossary"
      });
      return { ...finding(meaning, [evidenceId], 70), term, meaning };
    });
}

function analyzeBill(page: ExtractedPage): BillAnalysis {
  const sentences = splitSentences(page.text);
  const evidenceItems: EvidenceItem[] = [];
  const summary = summaryEvidence(page, evidenceItems, sentences);
  const changes = proposedChangeFindings(page, evidenceItems, sentences);
  const groups = affectedGroupFindings(page, evidenceItems, sentences);
  const supporters = supporterOpponentFindings(page, evidenceItems, sentences, "support");
  const opponents = supporterOpponentFindings(page, evidenceItems, sentences, "oppose");
  const unclearImpacts = unclearImpactFindings(page, evidenceItems, sentences);
  const terms = importantTermFindings(page, evidenceItems);
  const mainIssue = mainIssueFinding(page, evidenceItems, sentences);
  const confidenceScore = confidenceFor(page, evidenceItems);

  return {
    id: makeId("analysis"),
    url: page.url,
    pageTitle: page.title,
    sourceName: page.sourceName,
    author: page.author,
    publishedAt: page.publishedAt,
    contentType: "bill",
    summary: summary.summary,
    summaryEvidenceIds: summary.evidenceIds,
    confidenceScore,
    confidenceReason: "This local heuristic review uses extracted bill text and does not replace the complete bill, official status, or legal analysis.",
    createdAt: new Date().toISOString(),
    evidence: evidenceItems,
    billNumber: billNumberFrom(page),
    billTitle: page.title || "Untitled bill",
    plainLanguageSummary: summary.summary,
    mainIssue,
    proposedChanges: changes,
    affectedGroups: groups,
    sourcedSupporters: supporters,
    sourcedOpponents: opponents,
    unclearImpacts,
    importantTerms: terms
  };
}

export function classifyPastedText(text: string, url = ""): ContentType {
  if (looksLikeBillText(text, url)) return "bill";
  if (text.trim().length < 120) return "unknown";
  return "article";
}

export function analyzePage(page: ExtractedPage): Analysis {
  const contentType = page.contentType === "unknown" ? classifyPastedText(page.text, page.url) : page.contentType;
  if (contentType === "unsupported" || !page.text.trim()) {
    throw new Error("This page does not look like a supported article or Congress.gov bill. Open a specific story or bill, or paste the text manually.");
  }
  const normalizedPage = { ...page, contentType };
  return contentType === "bill" ? analyzeBill(normalizedPage) : analyzeArticle({ ...normalizedPage, contentType: "article" });
}
