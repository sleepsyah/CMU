import { cleanReadableSourceText, confidenceLabel, FRAME_LABELS } from "./analysis";
import type {
  AiAnalysis,
  AiConnectionStatus,
  AiLoginResult,
  AiProvider,
  Analysis,
  AnalysisTraceEvent,
  AnalysisFinding,
  BackendBiasAnalysis,
  BiasDimension,
  BiasMetric,
  BiasSignal,
  EvidenceItem,
  ExtractedPage,
  FactCheck,
  ArticleGenre,
  FrameLabel,
  FrameSignal
} from "../types";

interface AiPayload {
  summary: string;
  summary_evidence: string[];
  genre: ArticleGenre;
  overall_bias: {
    score: number;
    level: "minimal" | "low" | "moderate" | "high";
    summary: string;
  };
  confidence_score: number;
  confidence_reason: string;
  frames: Array<{
    label: FrameLabel;
    strength: number;
    explanation: string;
    evidence_quotes: string[];
  }>;
  signals: Array<{
    dimension: BiasDimension;
    category: BiasSignal["category"];
    phrase: string;
    context: string;
    explanation: string;
    neutral_alternative: string;
    severity: BiasSignal["severity"];
  }>;
  review_questions: string[];
  findings: Array<{
    section: "main_issue" | "included_perspective" | "review_question" | "proposed_change" | "affected_group" | "sourced_supporter" | "sourced_opponent" | "unclear_impact";
    text: string;
    evidence_quote: string;
  }>;
  source_participation: {
    named_sources: Array<{ name: string; evidence_quote: string }>;
    attributed_perspectives: Array<{ text: string; evidence_quote: string }>;
  };
  important_terms: Array<{
    term: string;
    meaning: string;
    evidence_quote: string;
  }>;
  fact_checks: Array<{
    claim: string;
    assessment: FactCheck["status"];
    explanation: string;
    source_quote: string;
    citations: Array<{
      url: string;
      label: string;
      evidence: string;
    }>;
  }>;
  _trace?: {
    reasoning_summaries?: string[];
    runtime_ms?: number;
    usage?: { input_tokens?: number; output_tokens?: number; reasoning_output_tokens?: number } | null;
    web_search_queries?: string[];
  };
}

interface NativeResponse<T> {
  ok: boolean;
  result?: T;
  error?: string;
}

async function nativeRequest<T>(action: "status" | "login" | "analyze", provider: AiProvider, payload?: Record<string, unknown>): Promise<T> {
  if (typeof chrome === "undefined" || !chrome.runtime?.id) {
    throw new Error("The Ellipsis AI Connector is available only in the installed Chrome extension.");
  }
  const response = await chrome.runtime.sendMessage({ type: "ellipsis.ai.request", action, payload: { ...payload, provider } }) as NativeResponse<T>;
  if (!response?.ok || response.result === undefined) throw new Error(response?.error || "Ellipsis AI Connector did not respond.");
  return response.result;
}

export async function checkAiConnection(provider: AiProvider): Promise<AiConnectionStatus> {
  return nativeRequest<AiConnectionStatus>("status", provider);
}

export async function beginAiLogin(provider: AiProvider): Promise<AiLoginResult> {
  return nativeRequest<AiLoginResult>("login", provider);
}

export function subscribeAiProgress(listener: (event: AnalysisTraceEvent) => void) {
  if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) return () => {};
  const handleMessage = (message: { type?: string; event?: AnalysisTraceEvent }) => {
    if (message?.type === "ellipsis.ai.progress" && message.event) listener(message.event);
  };
  chrome.runtime.onMessage.addListener(handleMessage);
  return () => chrome.runtime.onMessage.removeListener(handleMessage);
}

export async function enhanceAnalysisWithAi(
  analysis: Analysis,
  page: ExtractedPage,
  provider: AiProvider,
  traceId = "",
  supportingAssessment?: BackendBiasAnalysis
): Promise<Analysis> {
  const readableText = cleanReadableSourceText(page.text).slice(0, 30_000);
  const payload = await nativeRequest<AiPayload>("analyze", provider, {
    title: analysis.pageTitle,
    source_name: analysis.sourceName,
    content_type: analysis.contentType,
    trace_id: traceId,
    raw_text: readableText,
    local_model_context: supportingAssessment ? modelSupportForAi(supportingAssessment) : undefined
  });
  if (!isAiPayload(payload)) throw new Error(`${providerLabel(provider)} returned an invalid analysis shape.`);
  return applyAiPayload(analysis, readableText, payload, provider, supportingAssessment);
}

export function checkCodexConnection() {
  return checkAiConnection("codex");
}

export function beginCodexLogin() {
  return beginAiLogin("codex");
}

export const subscribeCodexProgress = subscribeAiProgress;

export function enhanceAnalysisWithCodex(analysis: Analysis, page: ExtractedPage, traceId = "") {
  return enhanceAnalysisWithAi(analysis, page, "codex", traceId);
}

function applyAiPayload(analysis: Analysis, sourceText: string, payload: AiPayload, provider: AiProvider, supportingAssessment?: BackendBiasAnalysis): Analysis {
  const providerName = providerLabel(provider);
  const evidence: EvidenceItem[] = [];
  const summaryEvidenceIds = payload.summary_evidence
    .map((quote) => matchedSourceQuote(sourceText, quote))
    .filter((quote): quote is string => Boolean(quote))
    .slice(0, 2)
    .map((quote) => addSourceEvidence(evidence, analysis, "Source passage supporting the AI summary.", quote, `${providerName} selected this exact source passage to support its summary.`));

  const frames = payload.frames
    .filter((frame) => FRAME_LABELS.includes(frame.label) && Array.isArray(frame.evidence_quotes) && Number.isFinite(frame.strength))
    .map((frame): FrameSignal | null => {
      const evidenceIds = frame.evidence_quotes
        .map((quote) => matchedSourceQuote(sourceText, quote))
        .filter((quote): quote is string => Boolean(quote))
        .slice(0, 2)
        .map((quote) => addSourceEvidence(
          evidence,
          analysis,
          `AI-assisted ${frame.label.toLowerCase()} frame evidence.`,
          quote,
          `${bounded(frame.explanation, 240)} This identifies emphasis, not political alignment or factual accuracy.`
        ));
      if (!evidenceIds.length) return null;
      return {
        id: makeId("frame_ai"),
        label: frame.label,
        strength: clamp(Math.round(frame.strength), 1, 100),
        explanation: bounded(frame.explanation, 240),
        evidenceIds,
        source: provider === "claude" ? "local-ai" : "local-codex"
      };
    })
    .filter((frame): frame is FrameSignal => Boolean(frame))
    .slice(0, 4);

  const aiSignals = payload.signals
    .map((signal): BiasSignal | null => {
      if (!["political", "gender", "ethnicity", "class"].includes(signal.dimension)) return null;
      if (!["loaded_language", "epistemic_framing", "persuasion", "stereotype_association"].includes(signal.category)) return null;
      if (![1, 2, 3].includes(signal.severity)) return null;
      const context = matchedSourceQuote(sourceText, signal.context);
      const phrase = matchedSourceQuote(sourceText, signal.phrase);
      if (!context || !phrase || !normalized(context).includes(normalized(phrase))) return null;
      return {
        id: makeId("bias_ai"),
        dimension: signal.dimension,
        category: signal.category,
        phrase,
        context,
        explanation: bounded(signal.explanation, 240),
        neutralAlternative: signal.neutral_alternative ? bounded(signal.neutral_alternative, 180) : undefined,
        severity: signal.severity
      };
    })
    .filter((signal): signal is BiasSignal => Boolean(signal))
    .filter((signal, index, values) => values.findIndex((item) => `${item.dimension}:${normalized(item.phrase)}:${normalized(item.context)}` === `${signal.dimension}:${normalized(signal.phrase)}:${normalized(signal.context)}`) === index)
    .slice(0, 8);

  const signalEvidenceIds = new Map<string, string>();
  for (const signal of aiSignals) {
    const evidenceId = addSourceEvidence(
      evidence,
      analysis,
      `AI-assisted ${dimensionLabel(signal.dimension).toLowerCase()} cue: “${signal.phrase}”.`,
      signal.context,
      `${signal.explanation}${signal.neutralAlternative ? ` Check: ${signal.neutralAlternative}` : ""}`
    );
    signalEvidenceIds.set(signal.id, evidenceId);
  }

  const aiFindings = payload.findings
    .map((item): (AnalysisFinding & { section: AiPayload["findings"][number]["section"] }) | null => {
      const text = bounded(item.text, 220);
      if (!text) return null;
      if (item.section === "review_question") return { ...analysisQuestion(evidence, text), section: item.section };
      const quote = matchedSourceQuote(sourceText, item.evidence_quote);
      if (!quote) return null;
      const evidenceId = addSourceEvidence(
        evidence,
        analysis,
        `AI-assisted ${item.section.replaceAll("_", " ")} evidence.`,
        quote,
        `${providerName} used this exact source passage for the corresponding finding.`
      );
      return { text, evidenceIds: [evidenceId], confidenceScore: 66, confidenceLabel: "Medium", section: item.section };
    })
    .filter((item): item is AnalysisFinding & { section: AiPayload["findings"][number]["section"] } => Boolean(item))
    .slice(0, 8);

  const namedSources = payload.source_participation.named_sources
    .map((item): AnalysisFinding | null => {
      const quote = matchedSourceQuote(sourceText, item.evidence_quote);
      const name = bounded(item.name, 140);
      if (!quote || !name) return null;
      const evidenceId = addSourceEvidence(evidence, analysis, `Named source: ${name}.`, quote, "The AI identified this source from the exact attributed passage.");
      return { text: name, evidenceIds: [evidenceId], confidenceScore: 70, confidenceLabel: "Medium" };
    })
    .filter((item): item is AnalysisFinding => Boolean(item));

  const attributedPerspectives = payload.source_participation.attributed_perspectives
    .map((item): AnalysisFinding | null => {
      const quote = matchedSourceQuote(sourceText, item.evidence_quote);
      const text = bounded(item.text, 220);
      if (!quote || !text) return null;
      const evidenceId = addSourceEvidence(evidence, analysis, "Attributed perspective identified by AI.", quote, "The AI tied this perspective to an exact source passage.");
      return { text, evidenceIds: [evidenceId], confidenceScore: 68, confidenceLabel: "Medium" };
    })
    .filter((item): item is AnalysisFinding => Boolean(item));

  const importantTerms = payload.important_terms
    .map((item): (AnalysisFinding & { term: string; meaning: string }) | null => {
      const quote = matchedSourceQuote(sourceText, item.evidence_quote);
      const term = bounded(item.term, 100);
      const meaning = bounded(item.meaning, 220);
      if (!quote || !term || !meaning) return null;
      const evidenceId = addSourceEvidence(evidence, analysis, `Important term: ${term}.`, quote, "The AI derived this term explanation from the cited source passage.");
      return { term, meaning, text: meaning, evidenceIds: [evidenceId], confidenceScore: 66, confidenceLabel: "Medium" as const };
    })
    .filter((item): item is AnalysisFinding & { term: string; meaning: string } => Boolean(item));

  const factChecks = payload.fact_checks
    .map((item): FactCheck | null => {
      if (!["supported", "contradicted", "unresolved", "context_needed"].includes(item.assessment)) return null;
      const sourceQuote = matchedSourceQuote(sourceText, item.source_quote);
      if (!sourceQuote) return null;
      const citations = item.citations
        .map((citation) => {
          const url = validWebUrl(citation.url);
          const evidenceText = bounded(citation.evidence, 320);
          if (!url || !evidenceText) return null;
          return {
            url,
            label: bounded(citation.label, 140) || new URL(url).hostname,
            evidence: evidenceText
          };
        })
        .filter((citation): citation is FactCheck["citations"][number] => Boolean(citation))
        .slice(0, 2);
      if (!citations.length) return null;
      return {
        id: makeId("fact_ai"),
        claim: bounded(item.claim, 240),
        status: item.assessment,
        explanation: bounded(item.explanation, 320),
        sourceText: sourceQuote,
        citations
      };
    })
    .filter((item): item is FactCheck => Boolean(item))
    .slice(0, 3);

  if (!summaryEvidenceIds.length && !frames.length && !aiSignals.length && !aiFindings.length) {
    throw new Error(`${providerName} did not return evidence-linked enhancements.`);
  }

  const reviewQuestions = payload.review_questions
    .map((question) => bounded(question, 220).trim())
    .filter((question) => question.length > 12)
    .slice(0, 3)
    .map((question) => analysisQuestion(evidence, question));
  const aiConfidence = clamp(Math.round(payload.confidence_score), 25, 88);
  const evidenceBonus = Math.min(8, summaryEvidenceIds.length + frames.length + aiSignals.length + aiFindings.length);
  const confidenceScore = clamp(aiConfidence + evidenceBonus, 30, 88);
  const confidenceReason = confidenceScore < 50
    ? `The extracted sample is short, so document-level framing and omission conclusions remain limited. ${providerName} evidence was matched to the supplied source, but this is not factuality confidence.`
    : `${bounded(payload.confidence_reason, 260)} This confidence reflects source coverage and evidence matching, not factual accuracy.`;
  const aiAnalysis: AiAnalysis = {
    source: provider === "claude" ? "local-ai" : "local-codex",
    provider,
    model: provider === "claude" ? "claude-sonnet-4-6" : "gpt-5.5",
    reasoningEffort: "low",
    summaryEvidenceIds,
    confidenceScore,
    confidenceReason,
    addedSignalCount: aiSignals.length,
    addedFrameCount: frames.length,
    addedFindingCount: aiFindings.length,
    outsideContextCount: 0,
    reasoningSummaryCount: payload._trace?.reasoning_summaries?.length || 0,
    runtimeMs: Math.max(0, Math.round(payload._trace?.runtime_ms || 0)),
    summaryRefined: summaryEvidenceIds.length > 0 && normalized(payload.summary) !== normalized(analysis.summary),
    webSearchCount: payload._trace?.web_search_queries?.length || 0,
    localModelSupport: supportingAssessment?.source === "hybrid-backend",
    outputSummary: bounded(payload.summary, 500),
    factChecks,
    researchSourceCount: new Set(factChecks.flatMap((item) => item.citations.map((citation) => citation.url))).size,
    reasoningSummaries: payload._trace?.reasoning_summaries?.slice(0, 4) || [],
    webSearchQueries: payload._trace?.web_search_queries?.slice(0, 3) || [],
    analyzedAt: new Date().toISOString()
  };

  const sharedUpdates = {
    summary: bounded(payload.summary, 500),
    summaryEvidenceIds,
    confidenceScore,
    confidenceReason,
    biasProfile: {
      score: clamp(Math.round(payload.overall_bias.score), 0, 100),
      level: payload.overall_bias.level,
      summary: bounded(payload.overall_bias.summary, 280)
    },
    evidence: dedupeEvidence(evidence),
    backendBias: aiBiasAssessment(aiSignals, provider),
    vocabularyTerms: importantTerms.map((item) => ({ term: item.term, meaning: item.meaning, evidenceIds: item.evidenceIds })),
    aiAnalysis
  };

  if (analysis.contentType === "article") {
    const mainIssue = aiFindings.find((item) => item.section === "main_issue");
    if (!mainIssue) throw new Error(`${providerName} did not return a source-linked main issue for the complete article analysis.`);
    const includedPerspectives = dedupeFindings([
      ...attributedPerspectives,
      ...aiFindings.filter((item) => item.section === "included_perspective")
    ]).slice(0, 8);
    const findingQuestions = aiFindings.filter((item) => item.section === "review_question");
    const framingNotes = frames.map((frame): AnalysisFinding => ({
      text: frame.explanation,
      evidenceIds: frame.evidenceIds,
      confidenceScore: 64,
      confidenceLabel: "Medium"
    }));
    const loadedLanguageExamples = aiSignals
      .filter((signal) => signal.dimension === "political")
      .map((signal) => ({
        text: signal.explanation,
        phrase: signal.phrase,
        context: signal.context,
        evidenceIds: signalEvidenceIds.has(signal.id) ? [signalEvidenceIds.get(signal.id) as string] : [],
        confidenceScore: 68,
        confidenceLabel: "Medium" as const
      }));
    return {
      ...analysis,
      ...sharedUpdates,
      genre: payload.genre,
      mainIssue,
      framingNotes,
      loadedLanguageExamples,
      quotedPeopleOrGroups: dedupeFindings(namedSources).slice(0, 8),
      includedPerspectives,
      missingPerspectives: dedupeFindings([...findingQuestions, ...reviewQuestions]).slice(0, 4),
      framingProfile: {
        dominantFrames: frames,
        namedSourceCount: namedSources.length,
        attributedPerspectiveCount: includedPerspectives.length,
        reviewQuestions: dedupeFindings([...findingQuestions, ...reviewQuestions]).slice(0, 4)
      }
    };
  }

  const mainIssue = aiFindings.find((item) => item.section === "main_issue");
  if (!mainIssue) throw new Error(`${providerName} did not return a source-linked main issue for the complete bill analysis.`);
  return {
    ...analysis,
    ...sharedUpdates,
    mainIssue,
    plainLanguageSummary: bounded(payload.summary, 500),
    proposedChanges: aiFindings.filter((item) => item.section === "proposed_change").slice(0, 7),
    affectedGroups: aiFindings.filter((item) => item.section === "affected_group").slice(0, 7),
    sourcedSupporters: aiFindings.filter((item) => item.section === "sourced_supporter").slice(0, 6),
    sourcedOpponents: aiFindings.filter((item) => item.section === "sourced_opponent").slice(0, 6),
    unclearImpacts: dedupeFindings([
      ...aiFindings.filter((item) => item.section === "unclear_impact" || item.section === "review_question"),
      ...reviewQuestions
    ]).slice(0, 6),
    importantTerms
  };
}

function aiBiasAssessment(signals: BiasSignal[], provider: AiProvider): BackendBiasAnalysis {
  return {
    source: provider === "claude" ? "ai-enhanced" : "codex-enhanced",
    scores: {
      political_bias: aiMetric(signals, "political"),
      gender_bias: aiMetric(signals, "gender"),
      ethnicity_bias: aiMetric(signals, "ethnicity"),
      class_bias: aiMetric(signals, "class")
    },
    linguistic_evidence: {
      spin_words_detected: signals.filter((signal) => signal.dimension === "political").map((signal) => signal.phrase),
      target_dependent_asymmetries: [],
      counterfactual_sentiment_delta: 0,
      signals
    },
    contextual_analysis: {
      missing_perspectives: [],
      stereotypical_associations: signals.filter((signal) => signal.category === "stereotype_association").map((signal) => signal.explanation)
    }
  };
}

function aiMetric(signals: BiasSignal[], dimension: BiasDimension): BiasMetric {
  const matches = signals.filter((signal) => signal.dimension === dimension);
  if (!matches.length) return { score: null, confidence: 0.58, evidenceCount: 0, status: "insufficient-evidence" };
  const severity = matches.reduce((sum, signal) => sum + signal.severity, 0);
  const score = clamp(14 + (severity * 9) + ((matches.length - 1) * 4), 1, 92);
  return {
    score,
    confidence: Math.min(0.82, 0.58 + (matches.length * 0.05)),
    evidenceCount: matches.length,
    status: "assessed"
  };
}

function analysisQuestion(evidence: EvidenceItem[], text: string): AnalysisFinding {
  const id = makeId("ev_ai_question");
  evidence.push({
    id,
    claim: "AI-assisted perspective question, not a confirmed omission.",
    supportingText: text,
    sourceUrl: null,
    sourceLabel: "Ellipsis AI analysis note",
    kind: "analysis_note",
    explanation: "A single source cannot prove omission. Use this question to inspect the full source and related reporting.",
    confidenceScore: 46,
    confidenceLabel: "Low"
  });
  return { text, evidenceIds: [id], confidenceScore: 46, confidenceLabel: "Low" };
}

function addSourceEvidence(evidence: EvidenceItem[], analysis: Analysis, claim: string, quote: string, explanation: string) {
  const existing = evidence.find((item) => item.kind === "source_text" && normalized(item.supportingText) === normalized(quote));
  if (existing) return existing.id;
  const id = makeId("ev_ai");
  evidence.push({
    id,
    claim,
    supportingText: quote,
    sourceUrl: /^https?:\/\//.test(analysis.url) ? analysis.url : null,
    sourceLabel: /^https?:\/\//.test(analysis.url) ? analysis.sourceName : "Pasted source text",
    kind: "source_text",
    explanation,
    confidenceScore: 68,
    confidenceLabel: confidenceLabel(68)
  });
  return id;
}

function matchedSourceQuote(sourceText: string, candidate: string) {
  const quote = bounded(candidate, 700).trim();
  if (quote.length < 3) return null;
  return normalized(sourceText).includes(normalized(quote)) ? quote : null;
}

function isAiPayload(value: AiPayload) {
  return Boolean(
    value && typeof value.summary === "string" &&
    Array.isArray(value.summary_evidence) &&
    typeof value.genre === "string" &&
    Number.isFinite(value.overall_bias?.score) &&
    ["minimal", "low", "moderate", "high"].includes(value.overall_bias?.level) &&
    typeof value.overall_bias?.summary === "string" &&
    Number.isFinite(value.confidence_score) &&
    typeof value.confidence_reason === "string" &&
    Array.isArray(value.frames) &&
    Array.isArray(value.signals) &&
    Array.isArray(value.review_questions) &&
    Array.isArray(value.findings) &&
    Array.isArray(value.source_participation?.named_sources) &&
    Array.isArray(value.source_participation?.attributed_perspectives) &&
    Array.isArray(value.important_terms) &&
    Array.isArray(value.fact_checks)
  );
}

export function aiProviderLabel(provider: AiProvider) {
  return provider === "claude" ? "Claude Code" : "Codex";
}

function providerLabel(provider: AiProvider) {
  return aiProviderLabel(provider);
}

function modelSupportForAi(assessment: BackendBiasAnalysis) {
  const metric = (value: BiasMetric) => ({
    score: value.score,
    confidence: value.confidence,
    evidence_count: value.evidenceCount,
    status: value.status
  });
  return {
    source: assessment.source,
    scores: {
      political: metric(assessment.scores.political_bias),
      gender: metric(assessment.scores.gender_bias),
      ethnicity: metric(assessment.scores.ethnicity_bias),
      class: metric(assessment.scores.class_bias)
    },
    source_matched_signals: assessment.linguistic_evidence.signals.slice(0, 10).map((signal) => ({
      dimension: signal.dimension,
      category: signal.category,
      phrase: signal.phrase,
      context: signal.context,
      severity: signal.severity
    }))
  };
}

function validWebUrl(value: string) {
  try {
    const parsed = new URL(value);
    return /^https?:$/.test(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function dimensionLabel(dimension: BiasDimension) {
  if (dimension === "gender") return "Gender framing";
  if (dimension === "ethnicity") return "Ethnicity framing";
  if (dimension === "class") return "Class framing";
  return "Political wording";
}

function dedupeEvidence(items: EvidenceItem[]) {
  const unique = new Map<string, EvidenceItem>();
  for (const item of items) {
    const key = `${item.kind}:${normalized(item.supportingText)}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return Array.from(unique.values());
}

function dedupeFindings(items: AnalysisFinding[]) {
  const unique = new Map<string, AnalysisFinding>();
  for (const item of items) if (!unique.has(normalized(item.text))) unique.set(normalized(item.text), item);
  return Array.from(unique.values());
}

function normalized(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function bounded(value: string, max: number) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`;
}

function makeId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value));
}
