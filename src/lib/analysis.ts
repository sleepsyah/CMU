import type {
  Analysis,
  ArticleAnalysis,
  BillAnalysis,
  ConfidenceLabel,
  ContentType,
  EvidenceItem,
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

const PERSPECTIVE_HINTS = [
  "supporter",
  "opponent",
  "advocate",
  "critic",
  "expert",
  "researcher",
  "official",
  "resident",
  "student",
  "worker",
  "business",
  "agency",
  "organization"
];

const TERM_GLOSSARY: Record<string, string> = {
  appropriation: "Permission for government money to be spent for a specific purpose.",
  amendment: "A formal change to existing law or to the text of a bill.",
  authorization: "Permission for a program or agency to operate, often before money is provided.",
  committee: "A smaller group of lawmakers that reviews a bill before it moves forward.",
  fiscal: "Related to government spending, revenue, or budgets.",
  regulation: "A rule created by a government agency to carry out a law.",
  subsidy: "Government support, often money or tax benefits, for a group or activity.",
  eligibility: "The rules that decide who can receive a benefit or take part in a program."
};

const GENERIC_SOURCE_NAMES = /^(supporters|opponents|critics|advocates|officials|experts|researchers|lawmakers|people|residents|students|workers)$/i;

function makeId(prefix: string) {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

function normalizeWhitespace(text: string) {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(text: string) {
  return normalizeWhitespace(text)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 24)
    .slice(0, 80);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function confidenceLabel(score: number): ConfidenceLabel {
  if (score >= 75) return "High";
  if (score >= 50) return "Medium";
  return "Low";
}

function confidenceFor(page: ExtractedPage, evidenceCount: number) {
  let score = 42;
  if (page.text.length > 1800) score += 18;
  if (page.text.length > 5000) score += 8;
  if (page.title.length > 8) score += 6;
  if (page.links.length > 0) score += 4;
  score += Math.min(evidenceCount * 4, 16);
  if (page.contentType === "unknown") score -= 16;
  return clamp(score, 25, 92);
}

function firstUsefulSentences(sentences: string[], count: number) {
  return sentences
    .filter((sentence) => !/cookie|subscribe|advertisement|newsletter/i.test(sentence))
    .slice(0, count);
}

function findSentenceFor(text: string, pattern: RegExp) {
  return splitSentences(text).find((sentence) => pattern.test(sentence)) || "";
}

function evidence(
  claim: string,
  supportingText: string,
  sourceUrl: string,
  explanation: string,
  confidenceScore: number
): EvidenceItem {
  return {
    id: makeId("ev"),
    claim,
    supportingText: supportingText || "No specific source sentence was available in the extracted text.",
    sourceUrl,
    explanation,
    confidenceScore,
    confidenceLabel: confidenceLabel(confidenceScore)
  };
}

function inferMainIssue(title: string, sentences: string[]) {
  const titleWords = title
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 8);

  if (titleWords.length >= 3) return titleWords.join(" ");
  return firstUsefulSentences(sentences, 1)[0]?.slice(0, 140) || "The main issue is unclear from the extracted text.";
}

function loadedLanguage(text: string) {
  const sentences = splitSentences(text);
  const matches: Array<{ phrase: string; context: string }> = [];

  for (const term of LOADED_TERMS) {
    const matcher = new RegExp(`\\b${term}\\b`, "i");
    const sentence = sentences.find((candidate) => matcher.test(candidate));
    if (sentence) {
      matches.push({ phrase: term, context: sentence });
    }
    if (matches.length >= 6) break;
  }

  return matches;
}

function quotedSources(text: string) {
  const names = new Set<string>();
  const patterns = [
    /(?:said|says|according to|told|wrote)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})/g,
    /([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})\s+(?:said|says|told|wrote|argued)/g,
    /according to\s+(the\s+)?([A-Z][A-Za-z&.\s-]{3,42})/g
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = normalizeWhitespace(match[2] || match[1] || "");
      if (
        value.length > 2 &&
        value.length < 60 &&
        !GENERIC_SOURCE_NAMES.test(value) &&
        !/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/.test(value)
      ) {
        names.add(value.replace(/^the\s+/i, ""));
      }
      if (names.size >= 8) break;
    }
  }

  return Array.from(names);
}

function includedPerspectives(text: string, quoted: string[]) {
  const lower = text.toLowerCase();
  const included = PERSPECTIVE_HINTS.filter((hint) => lower.includes(hint)).map((hint) => {
    if (hint === "expert") return "Expert or researcher perspective";
    if (hint === "official") return "Government or official perspective";
    if (hint === "critic") return "Critical perspective";
    if (hint === "supporter") return "Supportive perspective";
    if (hint === "opponent") return "Opposing perspective";
    return `${hint[0].toUpperCase()}${hint.slice(1)} perspective`;
  });

  if (quoted.length > 0) included.unshift("Directly quoted sources");
  return Array.from(new Set(included)).slice(0, 5);
}

function missingPerspectives(included: string[]) {
  const missing = [];
  const joined = included.join(" ").toLowerCase();
  if (!joined.includes("opposing") && !joined.includes("critical")) missing.push("Opposing or skeptical voices are not clear in the extracted text.");
  if (!joined.includes("expert") && !joined.includes("researcher")) missing.push("Independent expert context may be missing.");
  if (!joined.includes("resident") && !joined.includes("student") && !joined.includes("worker")) {
    missing.push("People directly affected by the issue are not clearly represented.");
  }
  return missing.slice(0, 4);
}

function framingNotesFor(page: ExtractedPage, loaded: Array<{ phrase: string; context: string }>, quoted: string[]) {
  const notes = [];
  if (loaded.length > 0) {
    notes.push("Some wording may push readers toward an emotional reaction before evidence is evaluated.");
  }
  if (quoted.length <= 1) {
    notes.push("The extracted text shows a narrow quoted-source base, so the article may rely on limited perspectives.");
  }
  if (/critics|supporters|opponents/i.test(page.text)) {
    notes.push("The article frames part of the issue through competing political or stakeholder reactions.");
  }
  if (notes.length === 0) {
    notes.push("No strong framing signal was found in the extracted text. Review the evidence because extraction may miss page context.");
  }
  return notes;
}

function analyzeArticle(page: ExtractedPage): ArticleAnalysis {
  const sentences = splitSentences(page.text);
  const summarySentences = firstUsefulSentences(sentences, 2);
  const loaded = loadedLanguage(page.text);
  const quoted = quotedSources(page.text);
  const included = includedPerspectives(page.text, quoted);
  const missing = missingPerspectives(included);
  const framingNotes = framingNotesFor(page, loaded, quoted);
  const ev: EvidenceItem[] = [];

  if (summarySentences[0]) {
    ev.push(
      evidence(
        "Summary is based on the opening extracted article text.",
        summarySentences[0],
        page.url,
        "The first substantive sentence usually states the topic or event the article is about.",
        78
      )
    );
  }

  if (loaded[0]) {
    ev.push(
      evidence(
        `Loaded language found: ${loaded[0].phrase}`,
        loaded[0].context,
        page.url,
        "This term can carry emotional judgment beyond a neutral description.",
        72
      )
    );
  }

  if (quoted[0]) {
    const sentence = findSentenceFor(page.text, new RegExp(quoted[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    ev.push(
      evidence(
        "Quoted or attributed source identified.",
        sentence,
        page.url,
        "Quoted people and groups help show whose views are represented.",
        68
      )
    );
  }

  const confidenceScore = confidenceFor(page, ev.length);
  return {
    id: makeId("analysis"),
    url: page.url,
    pageTitle: page.title,
    sourceName: page.sourceName,
    contentType: "article",
    summary: summarySentences.join(" ") || "The article text could not be summarized confidently from the extracted page content.",
    confidenceScore,
    confidenceReason:
      confidenceScore < 50
        ? "The extracted text was short, incomplete, or lacked enough attributable evidence."
        : "The analysis is based on extracted page text and specific article evidence.",
    createdAt: new Date().toISOString(),
    evidence: ev,
    mainIssue: inferMainIssue(page.title, sentences),
    framingNotes,
    loadedLanguageExamples: loaded,
    quotedPeopleOrGroups: quoted.length ? quoted : ["No clear quoted people or groups were found in the extracted text."],
    includedPerspectives: included.length ? included : ["The represented perspectives are unclear from the extracted text."],
    missingPerspectives: missing
  };
}

function billNumberFrom(page: ExtractedPage) {
  const urlMatch = page.url.match(/\/bill\/\d+(?:st|nd|rd|th)-congress\/([^/]+)\/(\d+)/i);
  if (urlMatch) return `${urlMatch[1].replace("-", " ").toUpperCase()} ${urlMatch[2]}`;
  const textMatch = page.text.match(/\b(H\.R\.|S\.|H\.Res\.|S\.Res\.)\s?\d+\b/i);
  return textMatch?.[0] || "Bill number not found";
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

function proposedChanges(text: string) {
  const sentences = splitSentences(text);
  const changeSentences = sentences.filter((sentence) => /\b(amend|establish|require|prohibit|authorize|appropriate|direct|create|increase|reduce)\b/i.test(sentence));
  return changeSentences.slice(0, 5);
}

function affectedGroups(text: string) {
  const groups = [
    "students",
    "workers",
    "families",
    "veterans",
    "small businesses",
    "agencies",
    "states",
    "schools",
    "patients",
    "consumers",
    "employers",
    "immigrants",
    "farmers",
    "taxpayers"
  ];
  return groups.filter((group) => new RegExp(`\\b${group}\\b`, "i").test(text)).slice(0, 6);
}

function supportersOpponents(text: string, mode: "support" | "oppose") {
  const verbPattern =
    mode === "support"
      ? /\b(supports|supported|endorses|endorsed|backed|backs)\b/i
      : /\b(opposes|opposed|criticized|objects|objected)\b/i;
  const actorPattern = /^\s*((?:The\s+)?[A-Z][A-Za-z&'-]+(?:\s+[A-Z][A-Za-z&'-]+){0,5})\s+/;
  const values = new Set<string>();

  for (const sentence of splitSentences(text)) {
    if (!verbPattern.test(sentence)) continue;
    const match = sentence.match(actorPattern);
    const actor = normalizeWhitespace(match?.[1] || "").replace(/^The\s+/i, "");
    if (!actor || GENERIC_SOURCE_NAMES.test(actor)) continue;
    values.add(actor);
    if (values.size >= 5) break;
  }

  return Array.from(values);
}

function importantTerms(text: string) {
  const found = Object.entries(TERM_GLOSSARY)
    .filter(([term]) => new RegExp(`\\b${term}\\b`, "i").test(text))
    .map(([term, meaning]) => ({ term, meaning }));
  return found.slice(0, 5);
}

function analyzeBill(page: ExtractedPage): BillAnalysis {
  const sentences = splitSentences(page.text);
  const summarySentences = firstUsefulSentences(sentences, 2);
  const changes = proposedChanges(page.text);
  const groups = affectedGroups(page.text);
  const terms = importantTerms(page.text);
  const supporters = supportersOpponents(page.text, "support");
  const opponents = supportersOpponents(page.text, "oppose");
  const ev: EvidenceItem[] = [];

  if (summarySentences[0]) {
    ev.push(
      evidence(
        "Plain-language bill summary is based on extracted bill text.",
        summarySentences[0],
        page.url,
        "The opening bill text or metadata often states the bill's subject.",
        76
      )
    );
  }

  if (changes[0]) {
    ev.push(
      evidence(
        "Potential proposed change identified.",
        changes[0],
        page.url,
        "Action verbs such as amend, require, authorize, or prohibit indicate what the bill may change.",
        70
      )
    );
  }

  if (groups[0]) {
    const sentence = findSentenceFor(page.text, new RegExp(`\\b${groups[0]}\\b`, "i"));
    ev.push(
      evidence(
        `Potentially affected group mentioned: ${groups[0]}`,
        sentence,
        page.url,
        "This group is mentioned in the bill text, but actual impact may require outside policy analysis.",
        58
      )
    );
  }

  const confidenceScore = confidenceFor(page, ev.length);
  return {
    id: makeId("analysis"),
    url: page.url,
    pageTitle: page.title,
    sourceName: page.sourceName,
    contentType: "bill",
    summary:
      summarySentences.join(" ") ||
      "The bill text could not be summarized confidently from the extracted page content.",
    confidenceScore,
    confidenceReason:
      confidenceScore < 50
        ? "The extracted bill text was incomplete or did not include enough bill-specific language."
        : "The analysis is based on extracted bill text and bill-specific action language.",
    createdAt: new Date().toISOString(),
    evidence: ev,
    billNumber: billNumberFrom(page),
    billTitle: page.title || "Untitled bill",
    plainLanguageSummary:
      summarySentences.join(" ") ||
      "This bill appears to require more complete source text before a reliable plain-language summary can be shown.",
    mainIssue: inferMainIssue(page.title, sentences),
    proposedChanges: changes.length ? changes : ["No clear proposed change was found in the extracted text."],
    affectedGroups: groups.length ? groups : ["No affected groups were clear from the extracted text."],
    sourcedSupporters: supporters,
    sourcedOpponents: opponents,
    unclearImpacts: [
      "Practical effects may depend on implementation, funding, enforcement, or later agency guidance.",
      "Supporters or opponents are only listed when the extracted text explicitly supports that claim."
    ],
    importantTerms: terms.length ? terms : [{ term: "No key terms found", meaning: "The extracted text did not include common legislative terms from the MVP glossary." }]
  };
}

export function classifyPastedText(text: string, url = ""): ContentType {
  if (looksLikeBillText(text, url)) return "bill";
  if (text.trim().length < 400) return "unknown";
  return "article";
}

export function analyzePage(page: ExtractedPage): Analysis {
  const contentType = page.contentType === "unknown" ? classifyPastedText(page.text, page.url) : page.contentType;
  if (contentType === "unsupported" || !page.text.trim()) {
    throw new Error("This page does not look like a supported article or Congress.gov bill. Open a specific story or bill, or paste the text manually.");
  }

  const normalizedPage = { ...page, contentType };

  if (contentType === "bill") return analyzeBill(normalizedPage);
  return analyzeArticle({ ...normalizedPage, contentType: "article" });
}
