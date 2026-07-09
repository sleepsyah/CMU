import { analyzePage, confidenceLabel } from "./analysis";
import type {
  Analysis,
  BackendBiasAnalysis,
  BiasDimension,
  BiasMetric,
  BiasSignal,
  EvidenceItem,
  ExtractedPage
} from "../types";

const configuredBackendUrl = import.meta.env.PUBLIC_UNFRAMED_BACKEND_URL?.trim() || "";
const BACKEND_TIMEOUT_MS = 5_000;

interface RawBiasMetric {
  score: number;
  confidence: number;
}

interface BackendPayload {
  scores: {
    political_bias: RawBiasMetric;
    gender_bias: RawBiasMetric;
    ethnicity_bias: RawBiasMetric;
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

export async function analyzePageWithBackend(page: ExtractedPage): Promise<Analysis> {
  const localAnalysis = analyzePage(page);
  const localAssessment = localBiasAssessment(page.text);
  const localBackendUrl = isLoopbackBackendUrl(configuredBackendUrl) ? configuredBackendUrl : "";

  if (!localBackendUrl) return attachBiasAssessment(localAnalysis, localAssessment);

  try {
    const backendPayload = await fetchBackendBias(localBackendUrl, page.text);
    return attachBiasAssessment(localAnalysis, mergeWithLocalBackend(localAssessment, backendPayload));
  } catch {
    return attachBiasAssessment(localAnalysis, localAssessment);
  }
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
  const timeout = window.setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
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
    window.clearTimeout(timeout);
  }
}

function isBackendPayload(value: BackendPayload) {
  const metrics = value?.scores && Object.values(value.scores);
  return Boolean(
    metrics?.length === 3 &&
    metrics.every((metric) => Number.isFinite(metric.score) && Number.isFinite(metric.confidence)) &&
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
  return { ...analysis, backendBias: assessment, evidence: [...analysis.evidence, ...biasEvidence] } as Analysis;
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
    sourceLabel: "unframed method note",
    kind: "analysis_note",
    explanation: "Scores estimate the strength of detected cues. A low score or an unassessed dimension does not prove neutrality, accuracy, or fair representation.",
    confidenceScore: 70,
    confidenceLabel: "Medium"
  });
  return items;
}

function mergeWithLocalBackend(local: BackendBiasAnalysis, backend: BackendPayload): BackendBiasAnalysis {
  const mergeMetric = (metric: BiasMetric, modelMetric: RawBiasMetric): BiasMetric => {
    if (metric.status === "insufficient-evidence" || metric.score === null) return metric;
    return {
      ...metric,
      score: Math.round((metric.score * 0.45) + (clamp(modelMetric.score, 0, 100) * 0.55)),
      confidence: Math.min(0.78, Math.max(metric.confidence, clamp(modelMetric.confidence, 0, 1) * 0.8))
    };
  };

  return {
    ...local,
    source: "hybrid-backend",
    scores: {
      political_bias: mergeMetric(local.scores.political_bias, backend.scores.political_bias),
      gender_bias: mergeMetric(local.scores.gender_bias, backend.scores.gender_bias),
      ethnicity_bias: mergeMetric(local.scores.ethnicity_bias, backend.scores.ethnicity_bias)
    },
    linguistic_evidence: {
      ...local.linguistic_evidence,
      spin_words_detected: Array.from(new Set([...local.linguistic_evidence.spin_words_detected, ...backend.linguistic_evidence.spin_words_detected])),
      target_dependent_asymmetries: backend.linguistic_evidence.target_dependent_asymmetries,
      counterfactual_sentiment_delta: backend.linguistic_evidence.counterfactual_sentiment_delta
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

  const genderPattern = associationPattern(genderGroups, genderStereotypes, 45);
  const ethnicityPattern = associationPattern(ethnicityGroups, hostileTerms, 55);
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
  }

  const politicalSignals = signals.filter((signal) => signal.dimension === "political");
  const genderSignals = signals.filter((signal) => signal.dimension === "gender");
  const ethnicitySignals = signals.filter((signal) => signal.dimension === "ethnicity");
  return {
    source: "local-heuristic",
    scores: {
      political_bias: scoreSignals(politicalSignals),
      gender_bias: scoreSignals(genderSignals),
      ethnicity_bias: scoreSignals(ethnicitySignals)
    },
    linguistic_evidence: {
      spin_words_detected: politicalSignals.map((signal) => signal.phrase),
      target_dependent_asymmetries: [],
      counterfactual_sentiment_delta: 0,
      signals
    },
    contextual_analysis: {
      missing_perspectives: [],
      stereotypical_associations: [...genderSignals, ...ethnicitySignals].map((signal) => signal.explanation).slice(0, 3)
    }
  };
}

function scoreSignals(signals: BiasSignal[]): BiasMetric {
  if (!signals.length) {
    return { score: null, confidence: 0.35, evidenceCount: 0, status: "insufficient-evidence" };
  }
  const severity = signals.reduce((sum, signal) => sum + signal.severity, 0);
  return {
    score: Math.min(100, 14 + (severity * 9) + ((signals.length - 1) * 4)),
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
  return assessment.scores.political_bias;
}

function dimensionLabel(dimension: BiasDimension) {
  if (dimension === "gender") return "Gender framing";
  if (dimension === "ethnicity") return "Ethnicity framing";
  return "Political wording";
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value));
}
