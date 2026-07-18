import type {
  ArticleSource,
  AttributionType,
  AttributionEvent,
  SourceEntityType,
  SourceRole,
  SourceExtractionDiagnostic,
  SourceCoverage
} from "../types";

interface SourceBlock {
  id: string;
  text: string;
}

export interface SourceExtractionResult {
  sources: ArticleSource[];
  sourceSummary: string;
  events: AttributionEvent[];
  diagnostics: SourceExtractionDiagnostic[];
  coverage: SourceCoverage;
}

const TEMPORAL_LABEL = /^(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day|january|february|march|april|may|june|july|august|september|october|november|december|today|tomorrow|yesterday|morning|afternoon|evening|night)$/i;
const PRONOUN_LABEL = /^(?:i|me|my|mine|we|us|our|ours|you|your|yours|he|him|his|she|her|hers|it|its|they|them|their|theirs|this|that|these|those)$/i;
const FURNITURE_BLOCK = /^(?:advertisement|add cbs news on google|link copied|read full bio|new updates?|more|copyright\b|follow updates\b|by\s+[A-Z][\p{L} .,'’–-]{1,100})$/iu;
const REPORTING_VERB = /\b(said|says|told|wrote|argued|warned|explained|reported|announced|stated|confirmed|called|denied|declined\s+to\s+comment|found|showed|according\s+to)\b/gi;
const DISPLAY_REPORTING_VERB = /\b(?:said|says|told|reported|announced|claimed|according\s+to|confirmed|stated|wrote|argued|warned|explained|denied|found|showed)\b/i;
const FINITE_CLAUSE_VERB = /\b(?:is|are|was|were|has|have|had|will|would|could|should|did|does|became|becomes|changed|changes|condemned|criticized|expressed|faced|faces|filed|joined|left|lost|maintained|met|registered|remained|remains|resigned|reversed|served|serves|struck|summoned|took|urged|won|worked|works)\b/i;
const FINITE_CLAUSE_PATTERN = /\b[a-z][a-z'’–-]*(?:ed|ing)\s+(?:as|on|at|after|before|against|by|during|for|from|into|over|to|with)\b/i;
const ATTRIBUTIVE_REPORTING_NOUN = /^(?:intention|plan|goal|policy|position|purpose|view|aim|proposal|request|desire|commitment|opposition|support|preference|objective|attack|strike|decision|statement|remarks?|comments?|figures?|data|results?|cases?)\b/i;
const SOURCE_DESCRIPTOR = /\b(?:administration|advocates?|agency|appeals court|association|auditors?|authority|broadcaster|business owners?|channel|coalition|command|committee|company|council|courts?|court filing|department|document|employees?|embassy|experts?|families|filing|foundation|government|governor|institute|judges?|lawmakers?|military|ministry|news|office|officials?|organization|patients?|people|poll|president|report|researchers?|residents?|rights chief|sen\.?|senator|spokesperson|study|students?|tenants?|union|university|voters?|witnesses?|workers?)\b/i;
const PERSON_TITLE = /\b(?:president|prime minister|foreign minister|governor|sen\.?|senator|rep\.?|representative|secretary|chair|director|commander|chief|general|gen\.?|spokesman|spokeswoman|spokesperson|mr\.?|mrs\.?|ms\.?|dr\.?)\b/i;
const PUBLIC_ROLE_TITLE = /\b(?:president|prime minister|foreign minister|governor|sen\.?|senator|rep\.?|representative|secretary|chair|director|commander|chief|general|gen\.?|spokesman|spokeswoman|spokesperson)\b/i;
const MEDIA_LABEL = /\b(?:news|agency|broadcaster|media|press|reuters|afp|associated press)\b/i;
const GOVERNMENT_LABEL = /\b(?:administration|authority|command|council|department|embassy|government|governor|military|ministry|official|president|prime minister|sen\.?|senator|secretary|spokesperson)\b/i;
const ORGANIZATION_LABEL = /\b(?:association|board|coalition|committee|company|corporation|foundation|hospital|institute|organization|school|union|university)\b/i;
const DATA_LABEL = /\b(?:data|dataset|poll|report|research|study|survey)\b/i;
const DOCUMENT_LABEL = /\b(?:court filing|document|filing|official statement|report|study|survey|statement)\b/i;
const ANONYMOUS_SOURCE = /^(?:an?|the)\s+((?:(?:senior|former|current)\s+)?(?:[A-Z][A-Za-z.]*\s+)?(?:official|source|spokesperson|diplomat|researcher))$/i;
const ANONYMOUS_GROUP = /^(?:two|three|four|several|multiple|some)\s+(?:(?:senior|former|current)\s+)?(?:[A-Z][A-Za-z.]*\s+)?(?:officials|sources|spokespeople|diplomats|researchers|witnesses)$/i;
const GENERIC_TITLE_ALIAS = /^(?:the\s+)?(president|governor|prime minister|foreign minister|secretary|spokesperson)$/i;
const GENERIC_INSTITUTION_ALIAS = /^(?:the\s+)?(?:ministry|department|agency|office|government|administration|military|command)$/i;
const HONORIFICS = /\b(?:mr|mrs|ms|dr|sen|senator|rep|representative|president|prime minister|foreign minister|governor|general|gen|secretary)\b/gi;
const ATTRIBUTION_CLAUSE_BOUNDARY = /\b(?:after|before|when|while|because|although|though|once|since|whereas)\b/gi;

function normalizeWhitespace(value: string) {
  return String(value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalizedEntity(value: string) {
  return normalizeWhitespace(value)
    .replace(/[’']/g, "'")
    .replace(/\b([A-Za-z]+)'s\b/g, "$1")
    .replace(/\./g, "")
    .replace(/^the\s+/i, "")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function sentenceParts(text: string) {
  const protectedText = normalizeWhitespace(text)
    .replace(/\b(?:[A-Z]\.){2,}/g, (value) => value.replaceAll(".", "∯"))
    .replace(/\b(?:Mr|Mrs|Ms|Dr|Sen|Rep|Gen|Gov|St)\./g, (value) => value.replace(".", "∯"));
  return protectedText
    .split(/(?<=[.!?])\s+(?=(?:["“']?[A-Z0-9]))/)
    .map((sentence) => sentence.replaceAll("∯", ".").trim())
    .filter((sentence) => sentence.length > 2);
}

function splitLongBlock(text: string, maxChars = 2400) {
  const sentences = sentenceParts(text);
  if (!sentences.length || text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let chunk = "";
  for (const sentence of sentences) {
    if (chunk && chunk.length + sentence.length + 1 > maxChars) {
      chunks.push(chunk);
      chunk = sentence;
    } else {
      chunk = chunk ? `${chunk} ${sentence}` : sentence;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function sourceBlocks(text: string) {
  const normalized = String(text || "").replace(/\r\n?/g, "\n").trim();
  const candidates = normalized.split(/\n{2,}/).map(normalizeWhitespace).filter(Boolean);
  const rawBlocks = candidates.length > 1 ? candidates : splitLongBlock(normalizeWhitespace(normalized));
  const blocks: SourceBlock[] = [];
  let skippedBlockCount = 0;
  let skippedCharacterCount = 0;
  for (const rawBlock of rawBlocks) {
    if (FURNITURE_BLOCK.test(rawBlock)) {
      skippedBlockCount += 1;
      skippedCharacterCount += rawBlock.length;
      continue;
    }
    for (const chunk of splitLongBlock(rawBlock)) blocks.push({ id: `block-${blocks.length + 1}`, text: chunk });
  }
  const coverage: SourceCoverage = {
    processedCharacterCount: Math.max(0, normalized.length - skippedCharacterCount),
    totalCharacterCount: normalized.length,
    blockCount: blocks.length,
    skippedBlockCount,
    skippedCharacterCount,
    skipped: skippedBlockCount > 0,
    truncated: false
  };
  return { blocks, coverage };
}

function cleanActor(value: string) {
  return normalizeWhitespace(value)
    .replace(/^["“”'‘’\s,;:]+|["“”'‘’\s,;:]+$/g, "")
    .replace(/^(?:and|but|while|although|though|according to|the)\s+/i, "")
    .replace(/\s+(?:after|before|during|when|while|at the briefing|in response)\b.*$/i, "")
    .replace(/\s+in\s+(?:a|the)\s+(?:statement|post|interview)$/i, "")
    .replace(/\s+(?:(?:has|had|also|since|repeatedly|later|earlier)\s*)+$/i, "")
    .trim();
}

function containsFinitePredicate(value: string) {
  return /\b(?:it|they|he|she|we|i|which|who|that)\s+(?:am|are|is|was|were|has|have|had|will|would|could|should|did|does|maintained|announced|said|reported)\b/i.test(value) ||
    FINITE_CLAUSE_VERB.test(value) ||
    FINITE_CLAUSE_PATTERN.test(value);
}

function startsWithNonFiniteModifier(value: string) {
  return /^(?:[a-z][a-z'’–-]*ing\s+(?:a|an|the|his|her|its|their)\b|(?:being|becoming|having|serving|working)\b)/.test(normalizeWhitespace(value));
}

export function validateSourceDisplayName(candidate: string, evidenceText: string) {
  const sourceSpan = normalizeWhitespace(candidate);
  let name = cleanActor(sourceSpan);
  const repairs: string[] = [];
  const reportingVerb = name.match(DISPLAY_REPORTING_VERB);
  if (reportingVerb?.index !== undefined) {
    const subject = cleanActor(name.slice(0, reportingVerb.index));
    if (subject) {
      name = subject;
      repairs.push("removed reporting verb and claim from source span");
    }
  }
  if (/[.!?]$/.test(name)) {
    name = name.replace(/[.!?]+$/, "").trim();
    repairs.push("removed sentence punctuation");
  }
  const words = name.split(/\s+/).filter(Boolean);
  const containsClause = containsFinitePredicate(name);
  const containsSentenceSyntax = /[“”"]|‘[^’]+’|\b\d{1,2}:\d{2}\b/.test(name);
  const stillHasReportingVerb = DISPLAY_REPORTING_VERB.test(name);
  const normalizedName = normalizedEntity(name);
  const normalizedEvidence = normalizedEntity(evidenceText);
  const overlap = normalizedName.length / Math.max(normalizedEvidence.length, 1);
  if (!name) return { name: null, sourceSpan, status: "rejected" as const, reason: "empty source span" };
  if (stillHasReportingVerb) return { name: null, sourceSpan, status: "rejected" as const, reason: "source span still contains a reporting verb" };
  if (startsWithNonFiniteModifier(name)) return { name: null, sourceSpan, status: "rejected" as const, reason: "source span is a non-finite modifier, not an attribution subject" };
  if (containsClause) return { name: null, sourceSpan, status: "rejected" as const, reason: "source span contains a finite clause" };
  if (containsSentenceSyntax) return { name: null, sourceSpan, status: "rejected" as const, reason: "source span contains sentence or quotation syntax" };
  if (words.length > 24) return { name: null, sourceSpan, status: "rejected" as const, reason: "source span exceeds the safe entity word limit" };
  if (words.length > 8 && overlap > 0.72 && !SOURCE_DESCRIPTOR.test(name)) {
    return { name: null, sourceSpan, status: "rejected" as const, reason: "source span substantially duplicates the evidence sentence" };
  }
  if (!actorLooksValid(name)) return { name: null, sourceSpan, status: "rejected" as const, reason: "source span is not an identifiable person or institution" };
  return {
    name,
    sourceSpan,
    status: repairs.length ? "repaired" as const : "accepted" as const,
    reason: repairs.join("; ") || "validated attribution subject"
  };
}

function actorLooksValid(actor: string) {
  if (!actor || actor.length < 2 || actor.length > 160 || TEMPORAL_LABEL.test(actor) || PRONOUN_LABEL.test(actor)) return false;
  if (ANONYMOUS_SOURCE.test(`a ${actor}`) || ANONYMOUS_SOURCE.test(actor) || ANONYMOUS_GROUP.test(actor)) return true;
  if (SOURCE_DESCRIPTOR.test(actor) || PERSON_TITLE.test(actor)) return true;
  if (/^[A-Z][A-Z0-9.&-]{1,14}$/.test(actor)) return true;
  if (/^[A-Z][\p{L}.'’–-]+(?:\s+(?:of|the|and|for|in|on)\s+|\s+)[A-Z][\p{L}.'’–-]+/u.test(actor)) return true;
  return /^[A-Z][\p{L}.'’–-]+$/u.test(actor);
}

function subjectBefore(sentence: string, verbIndex: number) {
  let prefix = sentence.slice(0, verbIndex).trim();
  if (!prefix || /["”']\s*,?$/.test(prefix)) return "";
  // A reporting verb belongs to the nearest grammatical clause, not necessarily
  // to the main subject at the beginning of the sentence.
  ATTRIBUTION_CLAUSE_BOUNDARY.lastIndex = 0;
  let boundarySubject = "";
  for (const boundary of prefix.matchAll(ATTRIBUTION_CLAUSE_BOUNDARY)) {
    if (boundary.index === undefined) continue;
    const candidate = cleanActor(prefix.slice(boundary.index + boundary[0].length));
    if (!startsWithNonFiniteModifier(candidate) && !containsFinitePredicate(candidate) && actorLooksValid(candidate)) {
      boundarySubject = candidate;
    }
  }
  if (boundarySubject) prefix = boundarySubject;
  else {
    // Remove a trailing relative clause before resolving the matrix subject:
    // "Rogoff, who spent 20 years as a prosecutor, said ..." -> "Rogoff".
    const relativeClause = prefix.match(/^(.*?),\s+(?:who|whom|whose|which|where)\b.*?,\s*$/i);
    if (relativeClause) prefix = relativeClause[1].trim();
  }
  const coordinateClauses = Array.from(prefix.matchAll(/\b(?:and|but)\b/gi));
  const coordinate = coordinateClauses.at(-1);
  if (coordinate?.index !== undefined) {
    const left = prefix.slice(0, coordinate.index).trim();
    const right = cleanActor(prefix.slice(coordinate.index + coordinate[0].length));
    if (containsFinitePredicate(left) && actorLooksValid(right)) prefix = right;
  }
  const clauses = prefix.split(/,\s+(?:and|but|while)\s+|;\s+/i);
  prefix = clauses.at(-1) || prefix;
  const updateLabel = prefix.lastIndexOf(":");
  if (updateLabel >= 0) prefix = prefix.slice(updateLabel + 1);
  const leadingClause = prefix.lastIndexOf(",");
  if (leadingClause >= 0) {
    const candidate = cleanActor(prefix.slice(leadingClause + 1));
    if (actorLooksValid(candidate)) prefix = candidate;
  }
  return cleanActor(prefix);
}

function quotedSegments(sentence: string) {
  const segments: string[] = [];
  for (const match of sentence.matchAll(/[“"]([^”"]{2,})[”"]|‘([^’]{2,})’/g)) {
    const text = normalizeWhitespace(match[1] || match[2]);
    if (text) segments.push(text);
  }
  return segments;
}

function isPrimaryDirectQuote(sentence: string, verbIndex: number, verb: string) {
  const afterVerb = sentence.slice(verbIndex + verb.length);
  return /^\s*[,;:]\s*[“"‘]/.test(afterVerb) || /^\s*[“"‘]/.test(afterVerb);
}

function roleFor(sentence: string, verb: string, actor: string, verbIndex: number): {
  role: SourceRole;
  type: AttributionType;
  quotedText?: string;
} {
  const quotes = quotedSegments(sentence);
  if (/declined\s+to\s+comment/i.test(verb)) return { role: "declined_comment", type: "declined_comment" };
  if (/denied/i.test(verb)) return { role: "paraphrased", type: "denial" };
  if (ANONYMOUS_SOURCE.test(actor) || ANONYMOUS_GROUP.test(actor) || /\b(?:official|source)\b/i.test(actor) && /^(?:an?|the)\b/i.test(actor)) {
    return { role: "anonymous_attribution", type: "anonymous_attribution" };
  }
  if ((DATA_LABEL.test(actor) || DOCUMENT_LABEL.test(actor)) && /\b(?:found|showed|reported|said|stated)\b/i.test(verb)) {
    return { role: "document_source", type: "document_source" };
  }
  if (quotes.length && isPrimaryDirectQuote(sentence, verbIndex, verb)) {
    return { role: "quoted", type: "direct_quote", quotedText: quotes[0] };
  }
  if (/\b(?:statement|official release|news release)\b/i.test(sentence)) return { role: "official_statement", type: "official_statement" };
  return { role: "paraphrased", type: "paraphrased", ...(quotes[0] ? { quotedText: quotes[0] } : {}) };
}

function event(input: {
  actor: string;
  sentence: string;
  claim?: string;
  role?: SourceRole;
  type: AttributionType;
  sentenceIndex: number;
  blockId: string;
  reportingIntermediary?: string;
  mentionedOnly?: boolean;
  quotedText?: string;
}, diagnostics: SourceExtractionDiagnostic[]): AttributionEvent | null {
  const validation = validateSourceDisplayName(input.actor, input.sentence);
  if (!validation.name) {
    diagnostics.push({
      sourceSpan: validation.sourceSpan,
      evidenceSpan: normalizeWhitespace(input.sentence),
      attributionClassification: input.type,
      decision: "rejected",
      reason: validation.reason
    });
    return null;
  }
  const actor = validation.name;
  diagnostics.push({
    sourceSpan: validation.sourceSpan,
    evidenceSpan: normalizeWhitespace(input.sentence),
    canonicalizationResult: actor,
    attributionClassification: input.type,
    decision: validation.status,
    reason: validation.reason
  });
  return {
    actor,
    claim: normalizeWhitespace(input.claim || input.sentence),
    evidenceText: normalizeWhitespace(input.sentence),
    sourceSpan: validation.sourceSpan,
    ...(input.quotedText ? { quotedText: normalizeWhitespace(input.quotedText) } : {}),
    sentenceIndex: input.sentenceIndex,
    blockId: input.blockId,
    attributionType: input.type,
    sourceRole: input.role,
    reportingIntermediary: input.reportingIntermediary ? cleanActor(input.reportingIntermediary) : undefined,
    mentionedOnly: Boolean(input.mentionedOnly)
  };
}

function nestedEvents(sentence: string, sentenceIndex: number, blockId: string, diagnostics: SourceExtractionDiagnostic[]) {
  const results: AttributionEvent[] = [];
  const invertedVia = sentence.match(/["”’][,;:]?\s+(.{2,140}?)\s+(said|says|reported|announced|stated|confirmed)\s*,?\s+according\s+to\s+([^,.;]{2,100})/i);
  if (invertedVia) {
    const primary = cleanActor(invertedVia[1]);
    const intermediary = cleanActor(invertedVia[3]);
    const quote = quotedSegments(sentence)[0];
    const primaryEvent = event({ actor: primary, sentence, claim: quote, role: "quoted", type: "direct_quote", quotedText: quote, sentenceIndex, blockId, reportingIntermediary: intermediary }, diagnostics);
    if (primaryEvent) results.push(primaryEvent);
    return results;
  }
  const primaryVia = sentence.match(/^(.{2,150}?)\s+(said|says|reported|announced|stated|confirmed)\s*,?\s+according\s+to\s+([^,.;]{2,100})/i);
  if (primaryVia) {
    const primary = cleanActor(primaryVia[1]);
    const intermediary = cleanActor(primaryVia[3]);
    const verbIndex = primaryVia.index! + primaryVia[1].length + 1;
    const primaryRole = roleFor(sentence, primaryVia[2], primary, verbIndex);
    const primaryEvent = event({ actor: primary, sentence, role: primaryRole.role, type: primaryRole.type, quotedText: primaryRole.quotedText, sentenceIndex, blockId, reportingIntermediary: intermediary }, diagnostics);
    if (primaryEvent) results.push(primaryEvent);
    return results;
  }

  const multiHop = sentence.match(/^(.{2,100}?)\s+(?:said|reported|wrote)\s*,?\s+citing\s+(?:the\s+)?(?:Telegram\s+channel|statement|post|report|data|figures)?\s*(?:of|from)\s+(?:the\s+)?([^,.;]{2,130})/i);
  if (multiHop) {
    const intermediary = cleanActor(multiHop[1]);
    const primary = cleanActor(multiHop[2]);
    const primaryEvent = event({ actor: primary, sentence, role: "paraphrased", type: "paraphrased", sentenceIndex, blockId, reportingIntermediary: intermediary }, diagnostics);
    if (primaryEvent) results.push(primaryEvent);
  }
  return results;
}

function eventsForSentence(sentence: string, sentenceIndex: number, blockId: string, diagnostics: SourceExtractionDiagnostic[]) {
  const nested = nestedEvents(sentence, sentenceIndex, blockId, diagnostics);
  if (nested.length) return nested;
  const results: AttributionEvent[] = [];

  const according = sentence.match(/^According\s+to\s+(?:the\s+)?([^,.;]{2,140})[,;]\s*(.+)$/i);
  if (according) {
    const actor = cleanActor(according[1]);
    const sourceEvent = event({ actor, sentence, claim: according[2], role: "paraphrased", type: "paraphrased", sentenceIndex, blockId }, diagnostics);
    if (sourceEvent) results.push(sourceEvent);
  }

  const inverted = sentence.match(/["”’][,;:]?\s+(?:said|says|told|wrote|argued|warned|explained)\s+(.{2,140}?)(?=\s+(?:after|before|during|when|while|at|in response)\b|[,.]|$)/i);
  if (inverted) {
    const sourceEvent = event({ actor: inverted[1], sentence, claim: quotedSegments(sentence)[0], role: "quoted", type: "direct_quote", quotedText: quotedSegments(sentence)[0], sentenceIndex, blockId }, diagnostics);
    if (sourceEvent) results.push(sourceEvent);
  }

  const trailingInverted = sentence.match(/[”"’][,;:]?\s+(?:the\s+)?(.{2,140}?)\s+(said|says|told|wrote|argued|warned|explained|reported|announced|stated|confirmed)(?=\s|[.,;:]|$)/i);
  if (trailingInverted) {
    const quote = quotedSegments(sentence)[0];
    const documentSource = DOCUMENT_LABEL.test(trailingInverted[1]);
    const sourceEvent = event({ actor: trailingInverted[1], sentence, claim: quote, role: documentSource ? "document_source" : "quoted", type: documentSource ? "document_source" : "direct_quote", quotedText: quote, sentenceIndex, blockId }, diagnostics);
    if (sourceEvent) results.push(sourceEvent);
  }

  REPORTING_VERB.lastIndex = 0;
  for (const match of sentence.matchAll(REPORTING_VERB)) {
    const verb = match[1];
    if (/according\s+to/i.test(verb) || match.index === undefined) continue;
    if (/^called$/i.test(verb) && /^\s+on\b/i.test(sentence.slice(match.index + match[0].length))) continue;
    const followingText = sentence.slice(match.index + match[0].length).trimStart();
    if (/^(?:stated|reported|confirmed|claimed|announced)$/i.test(verb) && ATTRIBUTIVE_REPORTING_NOUN.test(followingText)) continue;
    const actor = subjectBefore(sentence, match.index);
    if (!actor || results.some((item) => normalizedEntity(item.actor) === normalizedEntity(actor))) continue;
    const attribution = roleFor(sentence, verb, actor, match.index);
    const claim = sentence.slice(match.index + match[0].length).replace(/^\s*[,;:]?\s*(?:that\s+)?/i, "");
    const sourceEvent = event({ actor, sentence, claim, role: attribution.role, type: attribution.type, quotedText: attribution.quotedText, sentenceIndex, blockId }, diagnostics);
    if (sourceEvent) results.push(sourceEvent);
  }

  if (!results.length) {
    const mention = sentence.match(/^((?:The\s+)?(?:U\.S\.|[A-Z][\p{L}.'’–-]+)(?:\s+[A-Z][\p{L}.'’–-]+){0,5})\s+(?:did\s+not\s+(?:immediately\s+)?claim|continues?|attacked|struck|targeted|held)\b/iu);
    if (mention) {
      const mentioned = event({ actor: mention[1], sentence, type: "mentioned_only", sentenceIndex, blockId, mentionedOnly: true }, diagnostics);
      if (mentioned) results.push(mentioned);
    }
  }

  if (!results.length && /^(?:It|There)\s+(?:was|were)\s+(?:said|reported|announced|claimed|confirmed|stated)\b/i.test(sentence)) {
    diagnostics.push({
      sourceSpan: "",
      evidenceSpan: normalizeWhitespace(sentence),
      decision: "rejected",
      reason: "no explicit attribution subject"
    });
  }

  return results;
}

function sourceEntityType(actor: string, roles: SourceRole[]): SourceEntityType {
  if (/^Unnamed\b/i.test(actor) || ANONYMOUS_SOURCE.test(actor) || ANONYMOUS_GROUP.test(actor)) return "anonymous_source";
  if (roles.includes("document_source") || DATA_LABEL.test(actor) || DOCUMENT_LABEL.test(actor)) return "document";
  if (MEDIA_LABEL.test(actor)) return "media";
  if (/^[A-Z][\p{L}.'’–-]+\s+[A-Z][\p{L}.'’–-]+\s*,/u.test(actor)) return "person";
  if (PERSON_TITLE.test(actor) && /[A-Z][\p{L}.'’–-]+\s+[A-Z][\p{L}.'’–-]+$/u.test(actor)) return "person";
  if (PERSON_TITLE.test(actor) && !/\b(?:agency|command|department|embassy|government|ministry|office)\b/i.test(actor)) return "person";
  if (GOVERNMENT_LABEL.test(actor)) return "government";
  if (ORGANIZATION_LABEL.test(actor)) return "organization";
  if (/^(?:[A-Z][\p{L}.'’–-]+\s+){1,4}[A-Z][\p{L}.'’–-]+(?:\s+of\s+[A-Z].*)?$/u.test(actor)) return "person";
  return "organization";
}

function surname(value: string) {
  const personValue = sourceEntityType(value, []) === "person" ? clearestPersonName(value) : value;
  const withoutAffiliation = personValue.replace(/\s+of\s+[A-Z].*$/i, "");
  const tokens = withoutAffiliation.replace(HONORIFICS, " ").match(/[A-Z][\p{L}.'’–-]+/gu) || [];
  return tokens.at(-1)?.replace(/[’']s$/i, "") || "";
}

function isInformativePersonName(value: string) {
  const withoutAffiliation = value.replace(/\s+of\s+[A-Z].*$/i, "").replace(HONORIFICS, " ").replace(/\b(?:U\.S\.|U\.N\.)\b/g, " ");
  return (withoutAffiliation.match(/[A-Z][\p{L}.'’–-]+/gu) || []).length >= 2;
}

function isAcronym(value: string) {
  const compact = value.replace(/[^A-Za-z0-9]/g, "");
  return compact.length >= 2 && compact.length <= 12 && compact === compact.toUpperCase();
}

function acronymCandidates(value: string) {
  const words = value
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:the|of|and|for|in|on)\b/gi, " ")
    .replace(/[^A-Za-z0-9. ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !/^(?:U\.?S\.?|U\.?N\.?)$/i.test(word));
  const values = new Set<string>();
  if (words.length >= 2) values.add(words.map((word) => word[0]).join("").toUpperCase());
  if (words.length >= 2 && words.length <= 4) {
    const recurse = (index: number, built: string) => {
      if (index === words.length) {
        if (built.length <= 12) values.add(built.toUpperCase());
        return;
      }
      for (let size = 2; size <= Math.min(5, words[index].length); size += 1) recurse(index + 1, built + words[index].slice(0, size));
    };
    recurse(0, "");
  }
  return values;
}

function informativeScore(value: string) {
  const tokens = normalizedEntity(value).split(/\s+/).filter(Boolean).length;
  return tokens * 10 + (PERSON_TITLE.test(value) ? 8 : 0) + (SOURCE_DESCRIPTOR.test(value) ? 4 : 0) + (value.includes(" of ") ? 3 : 0) + Math.min(value.length / 100, 1);
}

function clearestPersonName(value: string) {
  const withoutLeadingTitle = normalizeWhitespace(value).replace(/^(?:(?:Republican|Democratic|GOP)\s+)?(?:President|Prime Minister|Foreign Minister|Governor|Sen\.?|Senator|Rep\.?|Representative|Secretary|Chair|Director|Commander|Chief|General|Gen\.?|Mr\.?|Mrs\.?|Ms\.?|Dr\.?)\s+/i, "");
  const leadingFullName = withoutLeadingTitle.match(/^([A-Z][\p{L}.'’–-]+(?:\s+(?:[A-Z]\.|[A-Z][\p{L}.'’–-]+)){1,3})\s*,/u)?.[1];
  if (leadingFullName) return leadingFullName;
  let name = normalizeWhitespace(value)
    .replace(/^(?:(?:Republican|Democratic|GOP)\s+)?(?:President|Prime Minister|Foreign Minister|Governor|Sen\.?|Senator|Rep\.?|Representative|Secretary|General|Gen\.?|Mr\.?|Mrs\.?|Ms\.?|Dr\.?)\s+/i, "")
    .replace(/^(?:U\.N\.|U\.S\.)\s+rights chief\s+/i, "")
    .replace(/\s+of\s+[A-Z].*$/u, "")
    .trim();
  const trailingFullName = value.match(/([A-Z][\p{L}.'’–-]+\s+[A-Z][\p{L}.'’–-]+)(?:\s+of\s+[A-Z].*)?$/u)?.[1];
  if (trailingFullName) name = trailingFullName;
  const nameTokens = name.match(/[A-Z][\p{L}.'’–-]+/gu) || [];
  if (nameTokens.length < 2) name = value;
  return name;
}

function clearestInstitutionName(value: string) {
  return normalizeWhitespace(value)
    .replace(/^((?:U\.S\.|U\.N\.|[A-Z][\p{L}.'’–-]+))\s+military[’']s\s+/iu, "$1 ");
}

function oneEditApart(left: string, right: string) {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let edits = 0;
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < a.length && rightIndex < b.length) {
    if (a[leftIndex] === b[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) leftIndex += 1;
    else if (b.length > a.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }
  return edits + Number(leftIndex < a.length || rightIndex < b.length) <= 1;
}

function likelySpellingVariant(left: string, right: string) {
  const a = clearestPersonName(left).match(/[A-Z][\p{L}.'’–-]+/gu) || [];
  const b = clearestPersonName(right).match(/[A-Z][\p{L}.'’–-]+/gu) || [];
  if (a.length !== 2 || b.length !== 2 || a[1].toLowerCase() !== b[1].toLowerCase()) return false;
  return Math.min(a[0].length, b[0].length) >= 5 && oneEditApart(a[0], b[0]);
}

function cleanContributionClaim(event: AttributionEvent) {
  let claim = normalizeWhitespace(event.quotedText || event.claim)
    .replace(/^\s*(?:on\s+)?(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day|today|yesterday)\s*,?\s*(?:that\s+)?/i, "")
    .replace(/^\s*(?:that\s+)?/i, "")
    .replace(/^(?:and|but)\s+/i, "")
    .replace(/^[“"‘]|[”"’]$/g, "")
    .trim();
  if (normalizedEntity(claim) === normalizedEntity(event.evidenceText)) claim = "";
  if (claim.length > 160) claim = `${claim.slice(0, 157).trimEnd()}…`;
  return claim.replace(/[.,;:]+$/, "");
}

function contributionClaimQuality(event: AttributionEvent) {
  const claim = cleanContributionClaim(event);
  if (!claim || /^(?:in|on|at|during)\s+(?:a|an|the)?\s*(?:statement|post|interview|briefing|X)\b/i.test(claim)) return 0;
  return Math.min(claim.split(/\s+/).filter(Boolean).length, 24);
}

function attributionEventScore(event: AttributionEvent) {
  return contributionClaimQuality(event) * 2 +
    (event.attributionType === "direct_quote" ? 6 : 0) +
    (["official_statement", "document_source", "denial"].includes(event.attributionType) ? 4 : 0);
}

function rankAttributionEvents(events: AttributionEvent[]) {
  return [...events].sort((left, right) => attributionEventScore(right) - attributionEventScore(left) || (left.sentenceIndex || 0) - (right.sentenceIndex || 0));
}

function contributionFor(events: AttributionEvent[]) {
  const event = events[0];
  if (!event) return "Provided information explicitly attributed by the article.";
  if (event.attributionType === "declined_comment") return "Declined to comment.";
  const claim = cleanContributionClaim(event);
  if (!claim) return event.reportingIntermediary
    ? `Provided information reported through ${event.reportingIntermediary}.`
    : "Provided information explicitly attributed by the article.";
  const lead = event.attributionType === "denial"
    ? "Denied that"
    : event.attributionType === "document_source"
      ? "Reported that"
      : event.attributionType === "direct_quote"
        ? "Said that"
        : "Stated that";
  const contributionClaim = /^(?:I\b|[A-Z]{2,}\b)/.test(claim) ? claim : `${claim[0].toLowerCase()}${claim.slice(1)}`;
  return `${lead} ${contributionClaim}${/[.!?…]$/.test(contributionClaim) ? "" : "."}`;
}

function sourcePriority(source: ArticleSource) {
  return (source.sourceRoles.includes("quoted") ? 6 : 0) +
    (source.sourceRoles.includes("official_statement") ? 5 : 0) +
    (source.sourceRoles.includes("document_source") ? 5 : 0) +
    (source.sourceRoles.includes("anonymous_attribution") ? 4 : 0) +
    Math.min(source.mentionCount, 3) +
    Math.min(source.contributionSummary.length / 100, 2);
}

function sourceSummaryFor(sources: ArticleSource[]) {
  if (!sources.length) return "";
  const anonymous = sources.filter((source) => source.entityType === "anonymous_source").length;
  const government = sources.filter((source) => source.entityType === "government").length;
  const documents = sources.filter((source) => source.entityType === "document").length;
  if (anonymous > sources.length / 2) return "Most attributed information comes from unnamed officials, witnesses, or other anonymous sources.";
  if (government >= Math.ceil(sources.length / 2)) return "The article primarily relies on government officials and agencies for attributed information.";
  if (government && sources.length - government > 0) return "The article attributes information to government sources alongside other named people, organizations, or documents.";
  if (documents) return "The article relies on named people or organizations as well as attributed reports, studies, or official documents.";
  return `The article draws on ${sources.length} clearly attributed source${sources.length === 1 ? "" : "s"}.`;
}

function affiliationFor(value: string) {
  const anonymous = value.match(/^(?:an?|the)\s+((?:[A-Z][A-Za-z.]*\s+)?)(?:official|source|spokesperson|diplomat|researcher)$/i);
  if (anonymous?.[1]) return normalizeWhitespace(anonymous[1]);
  if (/\b(?:agency|command|department|embassy|ministry|office)\b/i.test(value)) {
    const possessive = value.match(/^([A-Z][\p{L}.]*(?:\s+[A-Z][\p{L}.]*){0,3})[’']s\s+(?:(?:Foreign|Defense|Interior)\s+)?(?:Agency|Command|Department|Embassy|Ministry|Office)\b/u);
    if (possessive?.[1]) return possessive[1];
    const prefix = value.match(/^((?:U\.?S\.?|U\.?N\.?|[A-Z][\p{L}.]*)(?:\s+[A-Z][\p{L}.]*){0,3})\s+(?:(?:Foreign|Defense|Interior|Central)\s+)?(?:Agency|Command|Department|Embassy|Ministry|Office)\b/u);
    return prefix?.[1];
  }
  const location = value.match(/\bof\s+([A-Z][\p{L}.'’–-]+(?:\s+[A-Z][\p{L}.'’–-]+){0,3})$/u);
  return location?.[1];
}

class UnionFind {
  parents: number[];
  constructor(size: number) { this.parents = Array.from({ length: size }, (_, index) => index); }
  find(index: number): number { return this.parents[index] === index ? index : (this.parents[index] = this.find(this.parents[index])); }
  union(left: number, right: number) { const a = this.find(left); const b = this.find(right); if (a !== b) this.parents[b] = a; }
}

function canonicalSources(events: AttributionEvent[]) {
  const sourceEvents = events.filter((item) => !item.mentionedOnly && item.sourceRole);
  const actors = Array.from(new Set(sourceEvents.map((item) => item.actor)));
  const union = new UnionFind(actors.length);
  const fullPeopleBySurname = new Map<string, number[]>();
  const roleAnchorsBySurname = new Map<string, number[]>();

  actors.forEach((actor, index) => {
    if (sourceEntityType(actor, []) !== "person") return;
    const key = surname(actor).toLowerCase();
    if (!key) return;
    if (isInformativePersonName(actor)) fullPeopleBySurname.set(key, [...(fullPeopleBySurname.get(key) || []), index]);
    if (PUBLIC_ROLE_TITLE.test(actor)) roleAnchorsBySurname.set(key, [...(roleAnchorsBySurname.get(key) || []), index]);
  });

  for (let left = 0; left < actors.length; left += 1) {
    for (let right = left + 1; right < actors.length; right += 1) {
      const a = actors[left];
      const b = actors[right];
      const normalizedA = normalizedEntity(a);
      const normalizedB = normalizedEntity(b);
      if (normalizedA === normalizedB) {
        union.union(left, right);
        continue;
      }

      const genericA = a.match(GENERIC_TITLE_ALIAS)?.[1]?.toLowerCase();
      const genericB = b.match(GENERIC_TITLE_ALIAS)?.[1]?.toLowerCase();
      if (genericA || genericB) {
        const genericIndex = genericA ? left : right;
        const candidateIndex = genericA ? right : left;
        const title = genericA || genericB;
        const candidates = actors.filter((actor) => !GENERIC_TITLE_ALIAS.test(actor) && new RegExp(`^(?:the\\s+)?${title?.replace(/\s+/g, "\\s+")}\\s+`, "i").test(actor));
        const candidateSurnames = new Set(candidates.map((actor) => surname(actor).toLowerCase()).filter(Boolean));
        if (candidateSurnames.size === 1 && candidates.includes(actors[candidateIndex])) union.union(genericIndex, candidateIndex);
        continue;
      }

      const aSurname = surname(a).toLowerCase();
      const bSurname = surname(b).toLowerCase();
      const aPerson = sourceEntityType(a, []) === "person";
      const bPerson = sourceEntityType(b, []) === "person";
      const aBareSurname = /^[A-Z][\p{L}.'’–-]+$/u.test(a);
      const bBareSurname = /^[A-Z][\p{L}.'’–-]+$/u.test(b);
      const personCompatible = (aPerson && bPerson) || (aPerson && bBareSurname) || (bPerson && aBareSurname);
      if (personCompatible && aSurname && aSurname === bSurname && likelySpellingVariant(a, b)) {
        union.union(left, right);
        continue;
      }
      const aShort = !isInformativePersonName(a) && Boolean(aSurname);
      const bShort = !isInformativePersonName(b) && Boolean(bSurname);
      const fullNameAnchors = fullPeopleBySurname.get(aSurname)?.length || 0;
      const roleAnchors = roleAnchorsBySurname.get(aSurname)?.length || 0;
      if (personCompatible && aSurname && aSurname === bSurname && (aShort || bShort) && (fullNameAnchors === 1 || (!fullNameAnchors && roleAnchors === 1))) {
        union.union(left, right);
        continue;
      }

      if (isAcronym(a) && acronymCandidates(b).has(a.replace(/[^A-Za-z0-9]/g, "").toUpperCase())) union.union(left, right);
      else if (isAcronym(b) && acronymCandidates(a).has(b.replace(/[^A-Za-z0-9]/g, "").toUpperCase())) union.union(left, right);
      else if (sourceEntityType(a, []) !== "person" && sourceEntityType(a, []) === sourceEntityType(b, []) && normalizedA.split(" ").length >= 2 && normalizedB.split(" ").length >= 2 && (normalizedA.endsWith(normalizedB) || normalizedB.endsWith(normalizedA))) union.union(left, right);
    }
  }

  const grouped = new Map<number, string[]>();
  actors.forEach((actor, index) => grouped.set(union.find(index), [...(grouped.get(union.find(index)) || []), actor]));
  const actorToDisplay = new Map<string, string>();
  const sources: ArticleSource[] = [];

  for (const aliases of grouped.values()) {
    const safeAliases = aliases.filter((alias) => {
      const evidenceText = sourceEvents.find((item) => normalizedEntity(item.actor) === normalizedEntity(alias))?.evidenceText || "";
      const validated = validateSourceDisplayName(alias, evidenceText);
      return Boolean(validated.name && normalizedEntity(validated.name) === normalizedEntity(alias));
    });
    if (!safeAliases.length) continue;
    if (safeAliases.every((alias) => GENERIC_TITLE_ALIAS.test(alias) || GENERIC_INSTITUTION_ALIAS.test(alias))) continue;
    let displayName = [...safeAliases].sort((a, b) => informativeScore(b) - informativeScore(a))[0];
    const anonymous = displayName.match(ANONYMOUS_SOURCE);
    if (anonymous) displayName = `Unnamed ${anonymous[1]}`;
    const acronym = safeAliases.find((alias) => isAcronym(alias) && normalizedEntity(alias) !== normalizedEntity(displayName));
    if (acronym && !displayName.includes("(")) displayName = `${displayName} (${acronym.replace(/\./g, "")})`;
    const relatedEvents = rankAttributionEvents(sourceEvents.filter((item) => safeAliases.some((alias) => normalizedEntity(alias) === normalizedEntity(item.actor))));
    const hasSubstantiveAttribution = relatedEvents.some((item) => contributionClaimQuality(item) > 0 || item.attributionType === "declined_comment");
    if (!hasSubstantiveAttribution) continue;
    const roles = Array.from(new Set(relatedEvents.map((item) => item.sourceRole).filter((role): role is SourceRole => Boolean(role))));
    const entityType = sourceEntityType(displayName, roles);
    if (entityType === "person") displayName = clearestPersonName(displayName);
    else displayName = clearestInstitutionName(displayName);
    safeAliases.forEach((alias) => actorToDisplay.set(normalizedEntity(alias), displayName));
    const evidence = relatedEvents.map(({ evidenceText, sourceSpan, quotedText, sentenceIndex, blockId, attributionType }) => ({
      evidenceText,
      sourceSpan,
      quotedText,
      sentenceIndex,
      blockId,
      attributionType
    }));
    const reportedVia = Array.from(new Set(relatedEvents.map((item) => item.reportingIntermediary).filter((item): item is string => Boolean(item))));
    sources.push({
      canonicalId: `source-${normalizedEntity(displayName).replace(/\s+/g, "-").slice(0, 80)}`,
      displayName,
      canonicalName: displayName,
      aliases: Array.from(new Set(safeAliases)),
      entityType,
      affiliation: affiliationFor(displayName),
      sourceRoles: roles,
      contributionSummary: contributionFor(relatedEvents),
      evidence,
      ...(reportedVia.length ? { reportedVia } : {}),
      mentionCount: relatedEvents.length
    });
  }

  for (const source of sources) {
    if (source.reportedVia) source.reportedVia = source.reportedVia.map((name) => actorToDisplay.get(normalizedEntity(name)) || name);
  }
  return sources
    .sort((a, b) => sourcePriority(b) - sourcePriority(a) || (a.evidence[0]?.sentenceIndex || 0) - (b.evidence[0]?.sentenceIndex || 0))
    .slice(0, 8);
}

/** Extract attribution events from every semantic block, then resolve aliases document-wide. */
export function extractSourcesAndVoices(text: string): SourceExtractionResult {
  const { blocks, coverage } = sourceBlocks(text);
  const events: AttributionEvent[] = [];
  const diagnostics: SourceExtractionDiagnostic[] = [];
  let sentenceIndex = 0;
  for (const block of blocks) {
    for (const sentence of sentenceParts(block.text)) {
      events.push(...eventsForSentence(sentence, sentenceIndex, block.id, diagnostics));
      sentenceIndex += 1;
    }
  }
  const uniqueEvents = events.filter((item, index, values) => values.findIndex((candidate) =>
    normalizedEntity(candidate.actor) === normalizedEntity(item.actor) &&
    candidate.blockId === item.blockId && candidate.sentenceIndex === item.sentenceIndex && candidate.attributionType === item.attributionType
  ) === index);
  const sources = canonicalSources(uniqueEvents);
  for (const diagnostic of diagnostics) {
    if (!diagnostic.canonicalizationResult) continue;
    const canonical = sources.find((source) => source.aliases.some((alias) => normalizedEntity(alias) === normalizedEntity(diagnostic.canonicalizationResult!)));
    if (canonical) diagnostic.canonicalizationResult = canonical.displayName;
  }
  if (import.meta.env.DEV && import.meta.env.MODE !== "test" && diagnostics.length) {
    console.debug("[Ellipsis] Sources and Voices extraction diagnostics", diagnostics);
  }
  return { sources, sourceSummary: sourceSummaryFor(sources), events: uniqueEvents, diagnostics, coverage };
}

export function sourceRoleLabel(source: Pick<ArticleSource, "sourceRoles">) {
  if (source.sourceRoles.includes("declined_comment")) return "Declined to comment";
  if (source.sourceRoles.includes("anonymous_attribution")) return "Anonymous official";
  if (source.sourceRoles.includes("official_statement")) return "Official statement";
  if (source.sourceRoles.includes("document_source")) return "Document or data source";
  if (source.sourceRoles.includes("quoted")) return "Quoted directly";
  return "Paraphrased by the article";
}
