import { analyzePage, cleanReadableSourceText, confidenceLabel } from "./analysis";
import { aiProviderLabel, enhanceAnalysisWithAi } from "./ai";
import type {
  AiSettings,
  Analysis,
  AnalysisTraceEvent,
  BackendBiasAnalysis,
  BiasProfile,
  BiasDimension,
  BiasMetric,
  BiasSignal,
  EvidenceItem,
  ExtractedPage
} from "../types";

const configuredBackendUrl = import.meta.env.PUBLIC_ELLIPSIS_BACKEND_URL?.trim() || "http://127.0.0.1:8000";
const BACKEND_HEALTH_TIMEOUT_MS = 750;
const BACKEND_TIMEOUT_MS = 15_000;

interface RawBiasMetric {
  score: number;
  confidence: number;
}

interface BackendPayload {
  scores: {
    political_bias: RawBiasMetric;
    gender_bias: RawBiasMetric;
    ethnicity_bias: RawBiasMetric;
    class_bias?: RawBiasMetric;
  };
  linguistic_evidence: {
    spin_words_detected: string[];
    target_dependent_asymmetries: BackendBiasAnalysis["linguistic_evidence"]["target_dependent_asymmetries"];
    counterfactual_sentiment_delta: number;
  };
  contextual_analysis: BackendBiasAnalysis["contextual_analysis"];
}

const politicalCues: Array<{
  phrase: string;
  category: BiasSignal["category"];
  severity: BiasSignal["severity"];
  explanation: string;
  neutralAlternative?: string;
}> = [
  ...[
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
    "blasted",
    "slam"
  ].map((phrase) => ({
    phrase,
    category: "loaded_language" as const,
    severity: 2 as const,
    explanation: "This word can add emotional or evaluative force. Its accuracy depends on the surrounding evidence.",
    neutralAlternative: "Describe the specific action, evidence, or consequence instead."
  })),
  ...[
    ["claimed", "said"],
    ["alleged", "said or alleged, with attribution"],
    ["admitted", "said or acknowledged"],
    ["confessed", "said or acknowledged"],
    ["boasted", "said"],
    ["conceded", "acknowledged"],
    ["insisted", "said"],
    ["purportedly", "according to the named source"],
    ["supposedly", "according to the named source"]
  ].map(([phrase, neutralAlternative]) => ({
    phrase,
    category: "epistemic_framing" as const,
    severity: 1 as const,
    explanation: "The reporting verb can influence how credible, certain, or reluctant a speaker appears.",
    neutralAlternative
  })),
  ...[
    "only choice",
    "everyone knows",
    "no reasonable person",
    "war on",
    "flood of"
  ].map((phrase) => ({
    phrase,
    category: "persuasion" as const,
    severity: 3 as const,
    explanation: "This phrase may compress a complex issue into an emotionally persuasive or all-or-nothing frame.",
    neutralAlternative: "State the concrete alternatives and evidence."
  }))
];

const genderGroups = ["woman", "women", "girl", "girls", "female", "mother", "mothers", "wife", "wives", "she", "her", "man", "men", "boy", "boys", "male", "father", "fathers", "husband", "husbands", "he", "him"];
const genderStereotypes = ["bossy", "emotional", "hysterical", "shrill", "weak", "motherly", "abrasive", "pretty", "unqualified"];
const ethnicityGroups = ["black", "white", "asian", "latino", "latina", "hispanic", "arab", "muslim", "jewish", "immigrant", "immigrants", "refugee", "refugees", "native american", "indigenous"];
const hostileTerms = ["criminal", "criminals", "gang", "gangs", "violent", "terrorist", "terrorists", "lazy", "threat", "threats", "illegal", "invasion", "unqualified"];
const classGroups = ["working class", "working-class", "low-income", "poor", "people in poverty", "wealthy", "rich", "affluent", "elite", "elites", "welfare recipients", "tenants", "landlords", "workers", "unemployed people", "homeless people"];
const classStereotypes = ["lazy", "irresponsible", "undeserving", "entitled", "greedy", "parasitic", "criminal", "uneducated", "inferior"];

const persuasionPatterns: Array<{
  label: string;
  pattern: RegExp;
  severity: BiasSignal["severity"];
  explanation: string;
  neutralAlternative: string;
}> = [
  {
    label: "appeal to fear",
    pattern: /\b(?:if (?:we|they|you) (?:do not|don't)|before it is too late|threatens? (?:our|the)|put(?:s|ting)? .{0,35} at risk)\b/i,
    severity: 2,
    explanation: "The sentence may use a feared consequence to increase urgency without fully establishing likelihood.",
    neutralAlternative: "State the predicted consequence, supporting evidence, and uncertainty."
  },
  {
    label: "black-and-white framing",
    pattern: /\b(?:either .{0,60} or|only two choices|with us or against us|no alternative|only choice)\b/i,
    severity: 3,
    explanation: "The sentence may present a complex issue as having only two possible positions or outcomes.",
    neutralAlternative: "Name the realistic alternatives and tradeoffs."
  },
  {
    label: "bandwagon claim",
    pattern: /\b(?:everyone knows|the whole country|all reasonable people|ordinary people all|nobody believes)\b/i,
    severity: 2,
    explanation: "The sentence may treat presumed popularity as evidence for a claim.",
    neutralAlternative: "Cite a specific poll, sample, or attributed group."
  },
  {
    label: "mind-reading claim",
    pattern: /\b(?:really wants?|secretly hopes?|doesn't care|does not care|only cares about|intends? to destroy|wants? people to suffer)\b/i,
    severity: 2,
    explanation: "The sentence assigns an internal motive or reaction that may not be directly evidenced.",
    neutralAlternative: "Attribute the motive to a source or describe observable conduct."
  },
  {
    label: "causal oversimplification",
    pattern: /\b(?:the reason is simple|caused entirely by|all because of|single cause|nothing more than)\b/i,
    severity: 2,
    explanation: "The sentence may reduce a multi-cause event to one explanation without showing competing factors.",
    neutralAlternative: "Describe the supported contributing factors and their limits."
  }
];

interface AnalysisOptions {
  aiEnabled?: boolean;
  aiSettings?: Pick<AiSettings, "enabled" | "provider">;
  traceId?: string;
  onProgress?: (event: AnalysisTraceEvent) => void;
}

function trace(options: AnalysisOptions, event: Omit<AnalysisTraceEvent, "runId" | "at">) {
  options.onProgress?.({
    ...event,
    runId: options.traceId || "",
    at: new Date().toISOString()
  });
}

export async function analyzePageWithBackend(page: ExtractedPage, options: AnalysisOptions = {}): Promise<Analysis> {
  const sourceStartedAt = Date.now();
  trace(options, { id: "gather-source", kind: "local", status: "running", title: "Gather source text", detail: "Extracting the readable article or bill text" });
  const readableText = cleanReadableSourceText(page.text);
  trace(options, { id: "gather-source", kind: "local", status: "completed", title: "Gather source text", detail: `${readableText.length.toLocaleString()} characters ready`, durationMs: Date.now() - sourceStartedAt });
  const localAnalysis = analyzePage(page);
  const localAssessment = localBiasAssessment(readableText);
  let fallbackAssessment = localAssessment;
  const aiEnabled = options.aiSettings?.enabled ?? options.aiEnabled ?? false;
  let aiFailureReason: string | undefined;
  if (aiEnabled) {
    const provider = options.aiSettings?.provider || "codex";
    const providerName = aiProviderLabel(provider);
    const localBackendUrl = isLoopbackBackendUrl(configuredBackendUrl) ? configuredBackendUrl : "";
    let supportingAssessment = localAssessment;
    trace(options, { id: "local-model-support", kind: "local", status: "running", title: "Local model support", detail: "Checking for the optional local model helper" });
    if (localBackendUrl && await backendIsReady(localBackendUrl)) {
      try {
        const backendPayload = await fetchBackendBias(localBackendUrl, readableText);
        supportingAssessment = mergeWithLocalBackend(localAssessment, backendPayload, readableText);
        fallbackAssessment = supportingAssessment;
        trace(options, { id: "local-model-support", kind: "local", status: "completed", title: "Local model support", detail: `Evidence-linked model signals are ready for ${providerName}` });
      } catch {
        trace(options, { id: "local-model-support", kind: "local", status: "completed", title: "Local model support", detail: `Local helper did not complete; ${providerName} will continue without it` });
      }
    } else {
      trace(options, { id: "local-model-support", kind: "local", status: "completed", title: "Local model support", detail: `Optional helper is not running; ${providerName} will continue without it` });
    }
    const supportedAnalysis = attachBiasAssessment(localAnalysis, supportingAssessment);
    try {
      const completed = await enhanceAnalysisWithAi(supportedAnalysis, page, provider, options.traceId, supportingAssessment);
      trace(options, { id: "ai-analysis", kind: "runtime", status: "completed", title: `${providerName} analysis`, detail: `${completed.aiAnalysis?.factChecks?.length || 0} researched checks, ${completed.aiAnalysis?.addedSignalCount || 0} bias cues, ${completed.aiAnalysis?.addedFrameCount || 0} frames` });
      return completed;
    } catch (error) {
      aiFailureReason = error instanceof Error ? error.message : "AI deep analysis did not complete.";
      trace(options, { id: "ai-analysis", kind: "runtime", status: "failed", title: `${providerName} analysis`, detail: aiFailureReason });
    }
  }

  const analysis = attachBiasAssessment(localAnalysis, fallbackAssessment);
  return aiFailureReason ? { ...analysis, aiFailureReason } as Analysis : analysis;
}

export function isLoopbackBackendUrl(value: string) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

async function fetchBackendBias(backendUrl: string, rawText: string): Promise<BackendPayload> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
  try {
    const response = await fetch(`${backendUrl.replace(/\/$/, "")}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw_text: rawText }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Local helper failed with ${response.status}`);
    const payload = await response.json() as BackendPayload;
    if (!isBackendPayload(payload)) throw new Error("Local helper returned an invalid response");
    return payload;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function backendIsReady(backendUrl: string) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), BACKEND_HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(`${backendUrl.replace(/\/$/, "")}/health`, { signal: controller.signal });
    if (!response.ok) return false;
    const payload = await response.json() as { status?: string; ready?: boolean };
    return payload.status === "ok" && payload.ready === true;
  } catch {
    return false;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function isBackendPayload(value: BackendPayload) {
  const metrics = value?.scores && [value.scores.political_bias, value.scores.gender_bias, value.scores.ethnicity_bias];
  return Boolean(
    metrics?.length === 3 &&
    metrics.every((metric) => metric && Number.isFinite(metric.score) && Number.isFinite(metric.confidence)) &&
    (!value.scores.class_bias || (Number.isFinite(value.scores.class_bias.score) && Number.isFinite(value.scores.class_bias.confidence))) &&
    Array.isArray(value?.linguistic_evidence?.spin_words_detected) &&
    Array.isArray(value?.contextual_analysis?.missing_perspectives)
  );
}

function attachBiasAssessment(analysis: Analysis, assessment: BackendBiasAnalysis): Analysis {
  const existingPassages = new Set(
    analysis.evidence
      .filter((item) => item.kind === "source_text")
      .map((item) => item.supportingText.trim().toLowerCase())
  );
  const biasEvidence = buildBiasEvidence(analysis, assessment)
    .filter((item) => item.kind !== "source_text" || !existingPassages.has(item.supportingText.trim().toLowerCase()));
  return { ...analysis, backendBias: assessment, biasProfile: biasProfileFromAssessment(assessment), evidence: [...analysis.evidence, ...biasEvidence] } as Analysis;
}

export function biasProfileFromAssessment(assessment: BackendBiasAnalysis): BiasProfile {
  const dimensions = [
    { label: "political framing", metric: assessment.scores.political_bias },
    { label: "gender framing", metric: assessment.scores.gender_bias },
    { label: "ethnicity framing", metric: assessment.scores.ethnicity_bias },
    { label: "class framing", metric: assessment.scores.class_bias }
  ];
  const assessed = dimensions.filter((item) => item.metric.status === "assessed" && item.metric.score !== null);
  if (!assessed.length) return { score: 0, level: "minimal", summary: "No direct political, gender, ethnicity, or class framing cues were found in the extracted source." };
  const weight = assessed.reduce((sum, item) => sum + Math.max(1, item.metric.evidenceCount), 0);
  const score = Math.round(assessed.reduce((sum, item) => sum + ((item.metric.score || 0) * Math.max(1, item.metric.evidenceCount)), 0) / weight);
  const level: BiasProfile["level"] = score < 20 ? "minimal" : score < 40 ? "low" : score < 70 ? "moderate" : "high";
  const strongest = [...assessed].sort((left, right) => (right.metric.score || 0) - (left.metric.score || 0))[0];
  const absent = dimensions.filter((item) => item.metric.status !== "assessed").map((item) => item.label.replace(" framing", ""));
  const summary = `${level === "high" ? "Strong" : level === "moderate" ? "Moderate" : level === "low" ? "Limited" : "Minimal"} ${strongest.label} is the main detected pattern${absent.length ? `; no direct ${absent.join(" or ")} cues were found` : ""}.`;
  return { score, level, summary };
}

function buildBiasEvidence(analysis: Analysis, assessment: BackendBiasAnalysis): EvidenceItem[] {
  const sourceUrl = /^https?:\/\//.test(analysis.url) ? analysis.url : null;
  const items: EvidenceItem[] = assessment.linguistic_evidence.signals.map((signal) => {
    const metric = metricForDimension(assessment, signal.dimension);
    const confidenceScore = Math.round(metric.confidence * 100);
    return {
      id: `ev_${signal.id}`,
      claim: `${dimensionLabel(signal.dimension)} cue: “${signal.phrase}”.`,
      supportingText: signal.context,
      sourceUrl,
      sourceLabel: sourceUrl ? analysis.sourceName : "Pasted source text",
      kind: "source_text" as const,
      explanation: `${signal.explanation}${signal.neutralAlternative ? ` A more neutral check: ${signal.neutralAlternative}` : ""}`,
      confidenceScore,
      confidenceLabel: confidenceLabel(confidenceScore)
    };
  });

  items.push({
    id: `ev_bias_method_${analysis.id}`,
    claim: "Bias scales are reading signals, not factuality ratings.",
    supportingText: assessment.source === "hybrid-backend"
      ? "Local heuristics were combined with a model running on this computer."
      : "Only evidence-linked heuristics running in the extension were used.",
    sourceUrl: null,
    sourceLabel: "Ellipsis method note",
    kind: "analysis_note",
    explanation: "Scores estimate the strength of detected cues. A low score or an unassessed dimension does not prove neutrality, accuracy, or fair representation.",
    confidenceScore: 70,
    confidenceLabel: "Medium"
  });
  return items;
}

function mergeWithLocalBackend(local: BackendBiasAnalysis, backend: BackendPayload, rawText: string): BackendBiasAnalysis {
  const sentences = splitSentences(rawText);
  const modelSignals = backend.linguistic_evidence.spin_words_detected.slice(0, 6).flatMap((phrase) => {
    const matcher = new RegExp(`\\b${escapeRegExp(phrase).replace(/\\ /g, "\\s+")}\\b`, "i");
    const context = sentences.find((sentence) => matcher.test(sentence));
    return context ? [makeSignal(
      "political",
      "loaded_language",
      phrase,
      context,
      "A local transformer identified this exact wording as a possible lexical framing cue.",
      2,
      "Check whether the source supports this wording with concrete evidence."
    )] : [];
  });
  const signals = [...local.linguistic_evidence.signals, ...modelSignals]
    .filter((signal, index, values) => values.findIndex((item) => `${item.dimension}:${item.phrase.toLowerCase()}:${item.context.toLowerCase()}` === `${signal.dimension}:${signal.phrase.toLowerCase()}:${signal.context.toLowerCase()}`) === index);
  const mergeMetric = (metric: BiasMetric, modelMetric: RawBiasMetric, dimension: BiasDimension): BiasMetric => {
    const dimensionSignals = signals.filter((signal) => signal.dimension === dimension);
    const evidenceMetric = metric.status === "assessed" && metric.score !== null ? metric : scoreSignals(dimensionSignals);
    if (evidenceMetric.status === "insufficient-evidence" || evidenceMetric.score === null) return metric;
    return {
      ...evidenceMetric,
      score: Math.min(92, Math.round((evidenceMetric.score * 0.45) + (clamp(modelMetric.score, 0, 100) * 0.55))),
      confidence: Math.min(0.78, Math.max(evidenceMetric.confidence, clamp(modelMetric.confidence, 0, 1) * 0.8)),
      evidenceCount: dimensionSignals.length
    };
  };

  return {
    ...local,
    source: "hybrid-backend",
    scores: {
      political_bias: mergeMetric(local.scores.political_bias, backend.scores.political_bias, "political"),
      gender_bias: mergeMetric(local.scores.gender_bias, backend.scores.gender_bias, "gender"),
      ethnicity_bias: mergeMetric(local.scores.ethnicity_bias, backend.scores.ethnicity_bias, "ethnicity"),
      class_bias: backend.scores.class_bias ? mergeMetric(local.scores.class_bias, backend.scores.class_bias, "class") : local.scores.class_bias
    },
    linguistic_evidence: {
      ...local.linguistic_evidence,
      spin_words_detected: Array.from(new Set([...local.linguistic_evidence.spin_words_detected, ...backend.linguistic_evidence.spin_words_detected])),
      target_dependent_asymmetries: backend.linguistic_evidence.target_dependent_asymmetries,
      counterfactual_sentiment_delta: backend.linguistic_evidence.counterfactual_sentiment_delta,
      signals
    },
    contextual_analysis: {
      missing_perspectives: backend.contextual_analysis.missing_perspectives.slice(0, 3),
      stereotypical_associations: Array.from(new Set([
        ...local.contextual_analysis.stereotypical_associations,
        ...backend.contextual_analysis.stereotypical_associations
      ])).slice(0, 3)
    }
  };
}

export function localBiasAssessment(text: string): BackendBiasAnalysis {
  const sentences = splitSentences(text);
  const signals: BiasSignal[] = [];

  for (const cue of politicalCues) {
    const matcher = new RegExp(`\\b${escapeRegExp(cue.phrase).replace(/\\ /g, "\\s+")}\\b`, "i");
    const context = sentences.find((sentence) => matcher.test(sentence));
    if (!context) continue;
    signals.push(makeSignal("political", cue.category, cue.phrase, context, cue.explanation, cue.severity, cue.neutralAlternative));
    if (signals.filter((signal) => signal.dimension === "political").length >= 6) break;
  }

  for (const item of persuasionPatterns) {
    const context = sentences.find((sentence) => item.pattern.test(sentence));
    if (!context) continue;
    signals.push(makeSignal(
      "political",
      "persuasion",
      item.label,
      context,
      item.explanation,
      item.severity,
      item.neutralAlternative
    ));
    if (signals.filter((signal) => signal.dimension === "political").length >= 8) break;
  }

  const genderPattern = associationPattern(genderGroups, genderStereotypes, 45);
  const ethnicityPattern = associationPattern(ethnicityGroups, hostileTerms, 55);
  const classPattern = associationPattern(classGroups, classStereotypes, 55);
  for (const sentence of sentences) {
    if (hasNegatedAssociation(sentence)) continue;
    const genderMatch = sentence.match(genderPattern);
    if (genderMatch && signals.filter((signal) => signal.dimension === "gender").length < 3) {
      const phrase = matchedCue(genderMatch[0], genderStereotypes) || "gendered description";
      signals.push(makeSignal(
        "gender",
        "stereotype_association",
        phrase,
        sentence,
        "A gender reference appears directly associated with a stereotyped descriptor. Context and attribution still matter.",
        2,
        "Describe the person's specific conduct, qualification, or evidence instead."
      ));
    }
    const ethnicityMatch = sentence.match(ethnicityPattern);
    if (ethnicityMatch && signals.filter((signal) => signal.dimension === "ethnicity").length < 3) {
      const phrase = matchedCue(ethnicityMatch[0], hostileTerms) || "demographic association";
      signals.push(makeSignal(
        "ethnicity",
        "stereotype_association",
        phrase,
        sentence,
        "A racial, ethnic, religious, or immigration group appears directly associated with hostile or negative framing.",
        2,
        "State the specific person, evidence, and relevant behavior without generalizing to a group."
      ));
    }
    const classMatch = sentence.match(classPattern);
    if (classMatch && signals.filter((signal) => signal.dimension === "class").length < 3) {
      const phrase = matchedCue(classMatch[0], classStereotypes) || "class association";
      signals.push(makeSignal(
        "class",
        "stereotype_association",
        phrase,
        sentence,
        "A socioeconomic group appears directly associated with a class-based stereotype or generalized judgment.",
        2,
        "Describe the specific conduct, material condition, or evidence without generalizing to an income or social group."
      ));
    }
  }

  const politicalSignals = signals.filter((signal) => signal.dimension === "political");
  const genderSignals = signals.filter((signal) => signal.dimension === "gender");
  const ethnicitySignals = signals.filter((signal) => signal.dimension === "ethnicity");
  const classSignals = signals.filter((signal) => signal.dimension === "class");
  return {
    source: "local-heuristic",
    scores: {
      political_bias: scoreSignals(politicalSignals),
      gender_bias: scoreSignals(genderSignals),
      ethnicity_bias: scoreSignals(ethnicitySignals),
      class_bias: scoreSignals(classSignals)
    },
    linguistic_evidence: {
      spin_words_detected: politicalSignals.map((signal) => signal.phrase),
      target_dependent_asymmetries: [],
      counterfactual_sentiment_delta: 0,
      signals
    },
    contextual_analysis: {
      missing_perspectives: [],
      stereotypical_associations: [...genderSignals, ...ethnicitySignals, ...classSignals].map((signal) => signal.explanation).slice(0, 3)
    }
  };
}

function scoreSignals(signals: BiasSignal[]): BiasMetric {
  if (!signals.length) {
    return { score: null, confidence: 0.35, evidenceCount: 0, status: "insufficient-evidence" };
  }
  const severity = signals.reduce((sum, signal) => sum + signal.severity, 0);
  return {
    score: Math.min(92, 14 + (severity * 9) + ((signals.length - 1) * 4)),
    confidence: Math.min(0.62, 0.44 + (signals.length * 0.04)),
    evidenceCount: signals.length,
    status: "assessed"
  };
}

function makeSignal(
  dimension: BiasDimension,
  category: BiasSignal["category"],
  phrase: string,
  context: string,
  explanation: string,
  severity: BiasSignal["severity"],
  neutralAlternative?: string
): BiasSignal {
  const index = `${dimension}_${phrase}_${context}`.replace(/\W+/g, "_").slice(0, 64);
  return { id: `bias_${index}`, dimension, category, phrase, context, explanation, severity, neutralAlternative };
}

function associationPattern(groups: string[], descriptors: string[], distance: number) {
  const group = groups.map(escapeRegExp).sort((a, b) => b.length - a.length).join("|");
  const descriptor = descriptors.map(escapeRegExp).sort((a, b) => b.length - a.length).join("|");
  const association = "(?:is|are|was|were|seems|seemed|called|described as|portrayed as|linked to|associated with|responsible for|caused|committed)?";
  return new RegExp(
    `(?:\\b(?:${group})\\b.{0,${distance}}${association}\\s*\\b(?:${descriptor})\\b|\\b(?:${descriptor})\\b.{0,${Math.floor(distance / 2)}}\\b(?:${group})\\b)`,
    "i"
  );
}

function hasNegatedAssociation(sentence: string) {
  return /\b(?:not|never|no evidence|without evidence|didn't|did not|doesn't|does not|rejects? the|denies? the)\b/i.test(sentence);
}

function matchedCue(text: string, cues: string[]) {
  return cues.find((cue) => new RegExp(`\\b${escapeRegExp(cue)}\\b`, "i").test(text));
}

function splitSentences(text: string) {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 20)
    .slice(0, 120);
}

function metricForDimension(assessment: BackendBiasAnalysis, dimension: BiasDimension) {
  if (dimension === "gender") return assessment.scores.gender_bias;
  if (dimension === "ethnicity") return assessment.scores.ethnicity_bias;
  if (dimension === "class") return assessment.scores.class_bias;
  return assessment.scores.political_bias;
}

function dimensionLabel(dimension: BiasDimension) {
  if (dimension === "gender") return "Gender framing";
  if (dimension === "ethnicity") return "Ethnicity framing";
  if (dimension === "class") return "Class framing";
  return "Political wording";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value));
}
