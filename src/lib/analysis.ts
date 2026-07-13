import type {
  Analysis,
  AnalysisFinding,
  ArticleGenre,
  ArticleAnalysis,
  BillAnalysis,
  ConfidenceLabel,
  ContentType,
  EvidenceItem,
  EvidenceKind,
  ExtractedPage,
  FrameLabel,
  FramingProfile
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

export const FRAME_LABELS: FrameLabel[] = [
  "Economic",
  "Capacity and resources",
  "Morality",
  "Fairness and equality",
  "Legality and constitutionality",
  "Policy prescription and evaluation",
  "Crime and punishment",
  "Security and defense",
  "Health and safety",
  "Quality of life",
  "Cultural identity",
  "Public opinion",
  "Political",
  "External regulation and reputation",
  "Other"
];

const FRAME_PATTERNS: Array<{ label: Exclude<FrameLabel, "Other">; pattern: RegExp; explanation: string }> = [
  { label: "Economic", pattern: /\b(cost|price|budget|tax|jobs?|wages?|economic|market|funding|spending|revenue)\b/i, explanation: "The source emphasizes financial costs, benefits, markets, labor, or public spending." },
  { label: "Capacity and resources", pattern: /\b(capacity|resources?|staffing|infrastructure|supply|shortage|implementation|feasibility)\b/i, explanation: "The source emphasizes whether institutions have the resources or ability to act." },
  { label: "Morality", pattern: /\b(moral|immoral|values?|ethical|duty|right thing|wrong|sin|responsibility)\b/i, explanation: "The source emphasizes values, duty, ethics, or moral judgment." },
  { label: "Fairness and equality", pattern: /\b(fair|unfair|equal|equality|equity|discriminat|rights?|justice|inequality)\b/i, explanation: "The source emphasizes distribution, fairness, equal treatment, or rights." },
  { label: "Legality and constitutionality", pattern: /\b(legal|illegal|lawful|unlawful|constitutional|court|judge|statute|jurisdiction|ruling)\b/i, explanation: "The source emphasizes legal authority, constitutionality, or judicial interpretation." },
  { label: "Policy prescription and evaluation", pattern: /\b(policy|proposal|plan|solution|reform|effective|ineffective|should|must|recommend)\b/i, explanation: "The source evaluates a policy response or argues for a course of action." },
  { label: "Crime and punishment", pattern: /\b(crime|criminal|arrest|police|prosecut|prison|sentence|punishment|offense|victim)\b/i, explanation: "The source emphasizes crime, enforcement, accountability, or punishment." },
  { label: "Security and defense", pattern: /\b(security|defense|military|war|attack|threat|border|terror|intelligence|national security)\b/i, explanation: "The source emphasizes safety from external or organized threats." },
  { label: "Health and safety", pattern: /\b(health|medical|patient|disease|hospital|safety|risk|injury|death|public health)\b/i, explanation: "The source emphasizes physical health, safety, harm, or prevention." },
  { label: "Quality of life", pattern: /\b(quality of life|housing|education|school|family|community|wellbeing|daily life|standard of living)\b/i, explanation: "The source emphasizes everyday wellbeing, services, family, or community life." },
  { label: "Cultural identity", pattern: /\b(culture|identity|tradition|religion|heritage|language|community values|way of life)\b/i, explanation: "The source emphasizes group identity, culture, tradition, or belonging." },
  { label: "Public opinion", pattern: /\b(poll|survey|voters?|public opinion|approval|disapproval|popular|unpopular|supporters?|opponents?)\b/i, explanation: "The source emphasizes public attitudes, polling, or perceived support." },
  { label: "Political", pattern: /\b(election|campaign|party|democrat|republican|parliament|congress|political|administration|lawmaker)\b/i, explanation: "The source emphasizes political actors, competition, institutions, or strategy." },
  { label: "External regulation and reputation", pattern: /\b(international|foreign|global|treaty|sanction|reputation|allies|diplomatic|regulation|oversight)\b/i, explanation: "The source emphasizes outside regulation, international pressure, or reputation." }
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
const MACHINE_SERIALIZATION = /(?:\bArray\s*\(\s*(?:\[[^\]]+\]\s*=>)?|\[(?:actionDate|displayText|externalActionCode|description|chamberOfAction|type|text)\]\s*=>|\b(?:Introduced|Passed(?:\/agreed to)?|Became Law|Committee)Array\s*\()/i;

function makeId(prefix: string) {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

function normalizeWhitespace(text: string) {
  return text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function cleanReadableBlock(text: string) {
  const value = normalizeWhitespace(text);
  const marker = value.search(MACHINE_SERIALIZATION);
  const readable = marker >= 0 ? value.slice(0, marker) : value;
  return readable.replace(/\s*\|?\s*Get alerts\s*$/i, "").trim();
}

export function cleanReadableSourceText(text: string) {
  return text
    .split(/\r?\n+/)
    .map(cleanReadableBlock)
    .filter((block) => block.length > 0 && !MACHINE_SERIALIZATION.test(block) && !/\[[A-Za-z][^\]]{0,40}\]\s*=>/.test(block))
    .join("\n\n")
    .trim();
}

export function cleanDisplayTitle(text: string) {
  let title = cleanReadableBlock(text)
    .replace(/\s+\|\s+(?:Congress\.gov|Library of Congress).*$/i, "")
    .trim();

  const billPrefix = /^((?:H\.R\.|S\.|H\.Res\.|S\.Res\.)\s*\d+)\s*[-–—]\s*\d+(?:st|nd|rd|th)\s+Congress\s*\(\d{4}\s*[-–—]\s*\d{4}\)\s*:?\s*/i;
  title = title.replace(billPrefix, "$1 - ");
  if (/^(?:H\.R\.|S\.|H\.Res\.|S\.Res\.)\s*\d+/i.test(title)) {
    title = title.replace(/\s+\d+(?:st|nd|rd|th)\s+Congress\s*\(\d{4}\s*[-–—]\s*\d{4}\)(?:\s*\|.*)?$/i, "");
  }
  return title || "Untitled source";
}

function splitSentences(text: string) {
  return cleanReadableSourceText(text)
    .split(/\n{2,}/)
    .flatMap((block) => normalizeWhitespace(block).split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 24 && !MACHINE_SERIALIZATION.test(sentence) && !/\[[A-Za-z][^\]]{0,40}\]\s*=>/.test(sentence))
    .slice(0, 120);
}

export function inferArticleGenre(page: Pick<ExtractedPage, "title" | "text">): ArticleGenre {
  const sample = `${page.title} ${page.text.slice(0, 2400)}`.toLowerCase();
  if (/\b(opinion|editorial|commentary|op-ed|column)\b/.test(sample)) return "opinion";
  if (/\b(investigation|investigative|records obtained|documents show|months-long)\b/.test(sample)) return "investigation";
  const dataSignals = new Set(sample.match(/\b(study|survey|research|report|dataset|statistics|margin of error|methodology)\b/g) || []);
  if (dataSignals.size >= 2) return "data_report";
  if (/\b(explainer|what to know|how it works|questions and answers|frequently asked)\b/.test(sample)) return "explainer";
  if (/\b(breaking|announced|announcement|hearing|ruling|election|protest|meeting|council reviewed)\b/.test(sample)) return "event";
  return "general";
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
    sourceLabel: "Ellipsis analysis note"
  });
}

function comparableText(value: string) {
  return cleanDisplayTitle(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function firstUsefulSentences(page: ExtractedPage, sentences: string[], count: number) {
  const title = comparableText(page.title);
  const useful = sentences.filter((sentence) => !/cookie|subscribe|advertisement|newsletter/i.test(sentence));
  const withoutTitle = useful.filter((sentence) => {
    const candidate = comparableText(sentence);
    return candidate.length < 20 || title.length < 20 || (!candidate.includes(title) && !title.includes(candidate));
  });
  return (withoutTitle.length ? withoutTitle : useful).slice(0, count);
}

const SUMMARY_STOPWORDS = new Set([
  "about", "after", "again", "against", "also", "among", "because", "been", "before", "being", "between", "could", "from", "have",
  "into", "more", "most", "other", "over", "said", "says", "some", "such", "than", "that", "their", "them", "then", "there", "these",
  "they", "this", "those", "through", "under", "very", "were", "what", "when", "where", "which", "while", "will", "with", "would"
]);

function summaryTokens(value: string) {
  return (value.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []).filter((token) => !SUMMARY_STOPWORDS.has(token));
}

function rankedSummarySentences(page: ExtractedPage, sentences: string[], count: number) {
  const useful = firstUsefulSentences(page, sentences, sentences.length);
  if (useful.length <= count) return useful;

  const titleTokens = new Set(summaryTokens(page.title));
  const frequency = new Map<string, number>();
  useful.forEach((sentence) => {
    new Set(summaryTokens(sentence)).forEach((token) => frequency.set(token, (frequency.get(token) || 0) + 1));
  });

  const ranked = useful
    .map((sentence, index) => {
      const tokens = summaryTokens(sentence);
      const uniqueTokens = new Set(tokens);
      const centrality = [...uniqueTokens].reduce((total, token) => total + Math.min(frequency.get(token) || 0, 4), 0) / Math.max(uniqueTokens.size, 1);
      const titleOverlap = [...uniqueTokens].filter((token) => titleTokens.has(token)).length;
      const positionSignal = index === 0 ? 1.2 : Math.max(0, 0.65 - index * 0.07);
      const detailSignal = /\b(?:according to|announced|approved|directed|found|reported|would|will|could|because|after|before|result|investigation)\b/i.test(sentence) ? 0.45 : 0;
      const lengthPenalty = sentence.length < 55 ? 0.8 : sentence.length > 420 ? 0.5 : 0;
      return { sentence, index, tokens: uniqueTokens, score: centrality + titleOverlap * 0.7 + positionSignal + detailSignal - lengthPenalty };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected: typeof ranked = [];
  for (const candidate of ranked) {
    const repeatsSelected = selected.some((existing) => {
      const shared = [...candidate.tokens].filter((token) => existing.tokens.has(token)).length;
      return shared / Math.max(Math.min(candidate.tokens.size, existing.tokens.size), 1) > 0.72;
    });
    if (!repeatsSelected) selected.push(candidate);
    if (selected.length === count) break;
  }

  return (selected.length ? selected : ranked.slice(0, count))
    .sort((a, b) => a.index - b.index)
    .map((candidate) => candidate.sentence);
}

function conciseSummaryClause(sentence: string) {
  const normalized = normalizeWhitespace(sentence);
  const naturalClause = normalized.split(/;\s+|,\s+(?=(?:according to|after|although|before|but|including|leading to|which|while|with)\b)/i)[0].trim();
  if (naturalClause.length <= 240) return naturalClause.replace(/[,:;]$/, "");

  const punctuation = Math.max(naturalClause.lastIndexOf(",", 240), naturalClause.lastIndexOf(";", 240));
  return punctuation >= 100 ? naturalClause.slice(0, punctuation).trim() : naturalClause;
}

function lowerSentenceLead(value: string) {
  return /^[A-Z][a-z]/.test(value) ? `${value[0].toLowerCase()}${value.slice(1)}` : value;
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
  const summarySentences = rankedSummarySentences(page, sentences, 2);
  if (!summarySentences.length) return { summary: "The extracted text was not complete enough to summarize.", evidenceIds: [] };
  const evidenceIds = summarySentences.map((sentence) =>
    addEvidence(evidenceItems, page, {
      claim: "Source passage used in the short summary.",
      supportingText: sentence,
      explanation: "This representative passage was selected from the extracted source text. It is not independently verified.",
      confidenceScore: 62
    })
  );
  const clauses = summarySentences.map(conciseSummaryClause).filter(Boolean);
  const [first, ...rest] = clauses;
  const lead = page.contentType === "bill" ? "The source explains that" : "The article reports that";
  const summary = [
    `${lead} ${lowerSentenceLead(first).replace(/[.!?]+$/, "")}.`,
    ...rest.map((clause) => `It also notes that ${lowerSentenceLead(clause).replace(/[.!?]+$/, "")}.`)
  ].join(" ");
  return { summary, evidenceIds };
}

function mainIssueFinding(page: ExtractedPage, evidenceItems: EvidenceItem[], sentences: string[]) {
  const sentence = firstUsefulSentences(page, sentences, 1)[0];
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

  const genericRoles = new Map<string, string>();
  const genericPattern = /\b(researchers|experts|officials|residents|students|workers|patients|families|witnesses|tenants|tenant advocates|business owners|budget staff)\s+(?:said|say|found|reported|argued|warned|explained|requested)\b/i;
  for (const sentence of sentences) {
    const role = sentence.match(genericPattern)?.[1];
    if (role) genericRoles.set(role.toLowerCase(), sentence);
  }
  for (const [role, sentence] of genericRoles) {
    const evidenceId = addEvidence(evidenceItems, page, {
      claim: `Attributed ${role} perspective identified.`,
      supportingText: sentence,
      explanation: "The source attributes this passage to a stakeholder category but does not necessarily identify a named speaker or establish expertise.",
      confidenceScore: 56
    });
    results.push(finding(`An attributed perspective from ${role} is included.`, [evidenceId], 56));
  }
  return results.slice(0, 8);
}

function missingPerspectiveFindings(
  page: ExtractedPage,
  evidenceItems: EvidenceItem[],
  included: AnalysisFinding[],
  quoted: ReturnType<typeof quotedSources>,
  genre: ArticleGenre
) {
  const joined = included.map((item) => item.text).join(" ").toLowerCase();
  const detected = quoted.length ? quoted.map((source) => source.name).join(", ") : "No named attributed sources detected";
  const suggestions: string[] = [];
  const hasIndependentContext = /\b(independent|expert|researcher|study|university|nonpartisan)\b/i.test(page.text);
  const hasAffectedVoice = /\b(residents|students|workers|patients|families|voters|tenants|tenant advocates|business owners)\s+(?:said|say|told|argued|reported|explained)\b/i.test(page.text);

  if (genre === "opinion") {
    if (!joined.match(/critical|opposing|counter/)) suggestions.push("Does the argument address the strongest reasonable counterargument?");
    if (!quoted.length && !/\b(study|report|data|record|document)\b/i.test(page.text)) suggestions.push("Which evidence supports the author's central claim?");
  } else if (genre === "data_report") {
    if (!/\b(method|methodology|sample|margin of error|limitation|confidence interval)\b/i.test(page.text)) suggestions.push("Does the source explain the data's method, sample, and limits?");
    if (!hasIndependentContext) suggestions.push("Would independent expert interpretation change how the findings should be read?");
  } else if (genre === "event") {
    if (!hasAffectedVoice) suggestions.push("Are people directly affected by the event represented in the reporting?");
    if (included.length < 2 && !hasIndependentContext) suggestions.push("Is the main account corroborated by another source or primary record?");
  } else if (genre === "investigation") {
    if (!/\b(responded|declined to comment|response|spokesperson said)\b/i.test(page.text)) suggestions.push("Did the people or organizations under scrutiny receive a meaningful chance to respond?");
    if (!/\b(record|document|filing|data|interview)\b/i.test(page.text)) suggestions.push("Which primary records support the investigation's central claim?");
  } else {
    if (!hasAffectedVoice) suggestions.push("Would a directly affected person's perspective add important context?");
    if (!hasIndependentContext) suggestions.push("Would primary documents or independent expertise clarify the central claim?");
  }

  return suggestions.slice(0, 2).map((text) => {
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
  if (included.length <= 1) {
    const noteId = addAnalysisNote(
      evidenceItems,
      page,
      "Narrow attributed-source base in extracted text.",
      `${included.length} attributed perspective${included.length === 1 ? " was" : "s were"} detected by the local parser.`,
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

function framingProfileFor(
  page: ExtractedPage,
  evidenceItems: EvidenceItem[],
  sentences: string[],
  quoted: ReturnType<typeof quotedSources>,
  included: AnalysisFinding[],
  reviewQuestions: AnalysisFinding[]
): FramingProfile {
  const candidates = FRAME_PATTERNS.map((frame) => {
    const matches = sentences.filter((sentence) => frame.pattern.test(sentence)).slice(0, 4);
    const distinctTerms = new Set(matches.flatMap((sentence) => sentence.toLowerCase().match(frame.pattern) || []));
    return { ...frame, matches, weight: matches.length + distinctTerms.size };
  })
    .filter((frame) => frame.matches.length > 0)
    .sort((a, b) => b.weight - a.weight || FRAME_LABELS.indexOf(a.label) - FRAME_LABELS.indexOf(b.label))
    .slice(0, 4);

  const dominantFrames = candidates.map((frame) => {
    const passage = frame.matches[0];
    const evidenceId = addEvidence(evidenceItems, page, {
      claim: `Potential ${frame.label.toLowerCase()} frame.`,
      supportingText: passage,
      explanation: `${frame.explanation} A frame describes emphasis, not whether the article is correct or politically aligned.`,
      confidenceScore: 55
    });
    return {
      id: makeId("frame"),
      label: frame.label,
      strength: clamp(28 + (frame.matches.length * 12) + (Math.min(frame.weight, 5) * 4), 32, 84),
      explanation: frame.explanation,
      evidenceIds: [evidenceId],
      source: "heuristic" as const
    };
  });

  return {
    dominantFrames,
    namedSourceCount: quoted.length,
    attributedPerspectiveCount: included.length,
    reviewQuestions
  };
}

function analyzeArticle(page: ExtractedPage): ArticleAnalysis {
  const sentences = splitSentences(page.text);
  const evidenceItems: EvidenceItem[] = [];
  const summary = summaryEvidence(page, evidenceItems, sentences);
  const mainIssue = mainIssueFinding(page, evidenceItems, sentences);
  const loaded = loadedLanguageFindings(page, evidenceItems, sentences);
  const quoted = quotedSources(page.text);
  const included = perspectiveFindings(page, evidenceItems, sentences, quoted);
  const genre = inferArticleGenre(page);
  const missing = missingPerspectiveFindings(page, evidenceItems, included, quoted, genre);
  const framingNotes = framingFindings(page, evidenceItems, loaded, included, quoted);
  const framingProfile = framingProfileFor(page, evidenceItems, sentences, quoted, included, missing);
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
    genre,
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
    missingPerspectives: missing,
    framingProfile
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
    results.push(finding(`${group[0].toUpperCase()}${group.slice(1)}: named near a legislative action; actual impact is uncertain.`, [evidenceId], 50));
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
  const readableText = cleanReadableSourceText(page.text);
  const contentType = page.contentType === "unknown" ? classifyPastedText(readableText, page.url) : page.contentType;
  if (contentType === "unsupported" || !readableText) {
    throw new Error("This page does not look like a supported article or Congress.gov bill. Open a specific story or bill, or paste the text manually.");
  }
  const normalizedPage = { ...page, title: cleanDisplayTitle(page.title), text: readableText, contentType };
  return contentType === "bill" ? analyzeBill(normalizedPage) : analyzeArticle({ ...normalizedPage, contentType: "article" });
}

export function keyFindingsFor(analysis: Analysis): AnalysisFinding[] {
  const candidates = analysis.contentType === "article"
    ? [
        ...analysis.loadedLanguageExamples,
        ...analysis.framingNotes.filter((item) => !item.text.startsWith("No strong framing signal")),
        ...analysis.missingPerspectives
      ]
    : [
        ...analysis.proposedChanges.filter((item) => !analysis.summary.includes(item.text)).slice(0, 1),
        ...analysis.affectedGroups.slice(0, 1),
        ...analysis.unclearImpacts.slice(0, 1)
      ];

  const unique = new Map<string, AnalysisFinding>();
  for (const item of candidates) {
    const key = item.text.trim().toLowerCase();
    if (key && !unique.has(key)) unique.set(key, item);
  }
  return Array.from(unique.values()).slice(0, 3);
}
