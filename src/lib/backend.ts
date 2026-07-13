import { analyzePage, cleanReadableSourceText, confidenceLabel } from "./analysis";
import type {
  Analysis,
  BackendBiasAnalysis,
  BiasDimension,
  BiasMetric,
  BiasSignal,
  EvidenceItem,
  ExtractedPage
} from "../types";

const configuredBackendUrl = import.meta.env.PUBLIC_ELLIPSIS_BACKEND_URL?.trim()
  || import.meta.env.PUBLIC_UNFRAMED_BACKEND_URL?.trim()
  || "";
const DEFAULT_LOOPBACK_BACKEND_URL = "http://127.0.0.1:8000";
const BACKEND_TIMEOUT_MS = import.meta.env.MODE === "test" ? 120 : 15_000;
const BACKEND_RETRY_DELAY_MS = import.meta.env.MODE === "test" ? 10 : 1_000;
const MAX_SIGNAL_SENTENCES = 3;

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

export type BackendStatus = {
  state: "ready" | "warming" | "offline";
  label: string;
  models?: Record<string, boolean>;
};

const genderGroups = ["woman", "women", "girl", "girls", "female", "mother", "mothers", "wife", "wives", "she", "her", "man", "men", "boy", "boys", "male", "father", "fathers", "husband", "husbands", "he", "him"];
const genderStereotypes = ["bossy", "emotional", "hysterical", "shrill", "weak", "motherly", "abrasive", "pretty", "unqualified"];
const ethnicityGroups = ["black", "white", "asian", "latino", "latina", "hispanic", "arab", "muslim", "jewish", "immigrant", "immigrants", "refugee", "refugees", "native american", "indigenous"];
const hostileTerms = ["criminal", "criminals", "gang", "gangs", "violent", "terrorist", "terrorists", "lazy", "threat", "threats", "illegal", "invasion", "unqualified"];
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

export async function analyzePageWithBackend(page: ExtractedPage): Promise<Analysis> {
  const readableText = cleanReadableSourceText(page.text);
  const localAnalysis = analyzePage(page);
  const localBackendUrl = backendUrl();
  try {
    const backendPayload = await fetchBackendBias(localBackendUrl, readableText);
    return attachBiasAssessment(localAnalysis, backendAssessment(readableText, backendPayload));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown backend error";
    return attachBiasAssessment(localAnalysis, fallbackAssessment(readableText, localBackendUrl, message));
  }
}

function backendUrl() {
  if (isLoopbackBackendUrl(configuredBackendUrl)) return configuredBackendUrl;
  return DEFAULT_LOOPBACK_BACKEND_URL;
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

export async function getBackendStatus(): Promise<BackendStatus> {
  try {
    const response = await fetch(`${backendUrl().replace(/\/$/, "")}/health`, { method: "GET" });
    if (!response.ok) throw new Error(`Health failed with ${response.status}`);
    const payload = await response.json() as { ready?: boolean; models?: Record<string, boolean> };
    const models = payload.models || {};
    if (payload.ready) return { state: "ready", label: "Backend ready", models };
    return { state: "warming", label: Object.keys(models).length ? "Backend partial" : "Backend warming", models };
  } catch {
    return { state: "offline", label: "Backend offline" };
  }
}

async function fetchBackendBias(backendUrl: string, rawText: string): Promise<BackendPayload> {
  const deadline = Date.now() + BACKEND_TIMEOUT_MS;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now());
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), remainingMs);
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
    } catch (error) {
      lastError = error;
      if (!shouldRetryBackendError(error) || Date.now() >= deadline) break;
      await sleep(Math.min(BACKEND_RETRY_DELAY_MS, Math.max(0, deadline - Date.now())));
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }

  const message = lastError instanceof Error ? lastError.message : "Backend helper did not respond before the timeout";
  throw new Error(message);
}

function shouldRetryBackendError(error: unknown) {
  if (!(error instanceof Error)) return true;
  return !/Local helper failed with 4\d\d|invalid response/i.test(error.message);
}

function sleep(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
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
    supportingText: assessment.source === "local-fallback"
      ? "The backend model helper was unavailable after the request timeout, so these 1-100 scores are marked heuristic fallback estimates."
      : "The 1-100 bias scores came from the local FastAPI model helper. The extension only trims source passages for evidence display and page highlighting.",
    sourceUrl: null,
    sourceLabel: "Ellipsis method note",
    kind: "analysis_note",
    explanation: "Scores estimate the strength of detected cues. A low score or an unassessed dimension does not prove neutrality, accuracy, or fair representation.",
    confidenceScore: 70,
    confidenceLabel: "Medium"
  });
  return items;
}

function fallbackAssessment(text: string, backendUrl: string, reason: string): BackendBiasAnalysis {
  const sentenceList = splitSentences(text);
  const signals: BiasSignal[] = [];

  for (const cue of politicalCues) {
    const context = contextForCue(sentenceList, cue.phrase);
    if (!context) continue;
    signals.push(makeSignal("political", cue.category, cue.phrase, context, cue.explanation, cue.severity, cue.neutralAlternative));
    if (signals.filter((signal) => signal.dimension === "political").length >= 6) break;
  }

  const genderPattern = associationPattern(genderGroups, genderStereotypes, 45);
  const ethnicityPattern = associationPattern(ethnicityGroups, hostileTerms, 55);
  for (const sentence of sentenceList) {
    if (hasNegatedAssociation(sentence)) continue;
    const genderMatch = sentence.match(genderPattern);
    if (genderMatch && signals.filter((signal) => signal.dimension === "gender").length < 3) {
      const phrase = matchedCue(genderMatch[0], genderStereotypes) || "gendered description";
      signals.push(makeSignal(
        "gender",
        "stereotype_association",
        phrase,
        sentence,
        "Heuristic fallback found a gender reference directly associated with a stereotyped descriptor.",
        2,
        "Backend model scoring was unavailable; treat this as a reading prompt, not a model result."
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
        "Heuristic fallback found a racial, ethnic, religious, or immigration group directly associated with hostile framing.",
        2,
        "Backend model scoring was unavailable; treat this as a reading prompt, not a model result."
      ));
    }
  }

  const politicalSignals = signals.filter((signal) => signal.dimension === "political");
  const genderSignals = signals.filter((signal) => signal.dimension === "gender");
  const ethnicitySignals = signals.filter((signal) => signal.dimension === "ethnicity");
  return {
    source: "local-fallback",
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
      missing_perspectives: [`Backend model helper at ${backendUrl} did not return in time, so this result is marked as a heuristic fallback. ${reason}`],
      stereotypical_associations: [...genderSignals, ...ethnicitySignals].map((signal) => signal.explanation).slice(0, 3)
    }
  };
}

function backendAssessment(text: string, backend: BackendPayload): BackendBiasAnalysis {
  const signals = signalsFromBackend(text, backend);
  return {
    source: "hybrid-backend",
    scores: {
      political_bias: metricFromBackend(backend.scores.political_bias, signals, "political"),
      gender_bias: metricFromBackend(backend.scores.gender_bias, signals, "gender"),
      ethnicity_bias: metricFromBackend(backend.scores.ethnicity_bias, signals, "ethnicity")
    },
    linguistic_evidence: {
      spin_words_detected: backend.linguistic_evidence.spin_words_detected,
      target_dependent_asymmetries: backend.linguistic_evidence.target_dependent_asymmetries,
      counterfactual_sentiment_delta: backend.linguistic_evidence.counterfactual_sentiment_delta,
      signals
    },
    contextual_analysis: {
      missing_perspectives: backend.contextual_analysis.missing_perspectives.slice(0, 3),
      stereotypical_associations: backend.contextual_analysis.stereotypical_associations.slice(0, 3)
    }
  };
}

function metricFromBackend(metric: RawBiasMetric, signals: BiasSignal[], dimension: BiasDimension): BiasMetric {
  return {
    score: Math.round(clamp(metric.score, 1, 100)),
    confidence: clamp(metric.confidence, 0, 1),
    evidenceCount: signals.filter((signal) => signal.dimension === dimension).length,
    status: "assessed"
  };
}

function signalsFromBackend(text: string, backend: BackendPayload): BiasSignal[] {
  const result: BiasSignal[] = [];
  const sentenceList = splitSentences(text);

  for (const word of backend.linguistic_evidence.spin_words_detected.slice(0, 6)) {
    const context = contextForCue(sentenceList, word);
    if (!context) continue;
    result.push(makeSignal(
      "political",
      "loaded_language",
      word,
      context,
      "The political RoBERTa/BABE pipeline identified this wording as a lexical bias or spin cue.",
      2,
      "Check whether the article supports this wording with direct evidence."
    ));
  }

  for (const asymmetry of backend.linguistic_evidence.target_dependent_asymmetries.slice(0, 4)) {
    const cue = asymmetry.associated_verbs[0] || asymmetry.target;
    const context = contextForCue(sentenceList, cue) || contextForCue(sentenceList, asymmetry.target);
    if (!context) continue;
    result.push(makeSignal(
      "political",
      "epistemic_framing",
      cue,
      context,
      "The dependency parser found uneven verbs or adjectives attached to named targets.",
      1,
      "Compare whether similar actors are described with similar verbs and evidence."
    ));
  }

  if (backend.scores.gender_bias.score >= 25 || backend.linguistic_evidence.counterfactual_sentiment_delta >= 0.08) {
    for (const context of demographicContexts(sentenceList, genderGroups).slice(0, 3)) {
      const phrase = matchedCue(context, genderStereotypes) || matchedCue(context, genderGroups) || "gender reference";
      result.push(makeSignal(
        "gender",
        "stereotype_association",
        phrase,
        trimContextToSentences(context),
        "The gender evaluator uses counterfactual sentiment, optional WinoBias/WinoGender-style coreference scoring, and gendered-language checks.",
        2,
        "Check whether the description is necessary, specific, and applied consistently."
      ));
    }
  }

  if (backend.scores.ethnicity_bias.score >= 25 || backend.linguistic_evidence.counterfactual_sentiment_delta >= 0.08) {
    for (const context of demographicContexts(sentenceList, ethnicityGroups).slice(0, 3)) {
      const phrase = matchedCue(context, hostileTerms) || matchedCue(context, ethnicityGroups) || "ethnicity reference";
      result.push(makeSignal(
        "ethnicity",
        "stereotype_association",
        phrase,
        trimContextToSentences(context),
        "The ethnicity evaluator uses demographic-token counterfactual sentiment, identity-toxicity scoring, and coded-hostility checks.",
        2,
        "Check whether the source ties negative framing to evidence about specific people rather than a whole group."
      ));
    }
  }

  return dedupeSignals(result).slice(0, 12);
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
  return { id: `bias_${index}`, dimension, category, phrase, context: trimContextToSentences(context), explanation, severity, neutralAlternative };
}

function scoreSignals(signals: BiasSignal[]): BiasMetric {
  if (!signals.length) {
    return { score: 1, confidence: 0.25, evidenceCount: 0, status: "assessed" };
  }
  const severity = signals.reduce((sum, signal) => sum + signal.severity, 0);
  return {
    score: Math.min(100, 14 + (severity * 9) + ((signals.length - 1) * 4)),
    confidence: Math.min(0.5, 0.32 + (signals.length * 0.04)),
    evidenceCount: signals.length,
    status: "assessed"
  };
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

function trimContextToSentences(text: string) {
  return splitSentences(text).slice(0, MAX_SIGNAL_SENTENCES).join(" ") || text.replace(/\s+/g, " ").trim();
}

function contextForCue(sentenceList: string[], cue: string) {
  const index = sentenceList.findIndex((sentence) => new RegExp(`\\b${escapeRegExp(cue)}\\b`, "i").test(sentence));
  if (index < 0) return "";
  const start = Math.max(0, index - 1);
  return sentenceList.slice(start, Math.min(sentenceList.length, start + MAX_SIGNAL_SENTENCES)).join(" ");
}

function demographicContexts(sentenceList: string[], terms: string[]) {
  return sentenceList
    .map((sentence, index) => ({ sentence, index }))
    .filter(({ sentence }) => terms.some((term) => new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(sentence)))
    .map(({ index }) => sentenceList.slice(index, Math.min(sentenceList.length, index + MAX_SIGNAL_SENTENCES)).join(" "));
}

function dedupeSignals(signals: BiasSignal[]) {
  const seen = new Set<string>();
  return signals.filter((signal) => {
    const key = `${signal.dimension}:${signal.phrase}:${signal.context}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
