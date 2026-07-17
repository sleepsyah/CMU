import type { Analysis, AttributionType, BiasDimension, BiasSignal } from "../types";

export const FEEDBACK_SCHEMA_VERSION = "1.0" as const;
export const FEEDBACK_STORAGE_KEY = "ellipsis.detectionFeedback.v1";
export const MAX_FEEDBACK_RECORDS = 1000;

export type FeedbackAccuracy = "accurate" | "inaccurate";
export type FeedbackDetectionType = "word" | "phrase" | "sentence" | "explanation" | "indicator";
export type FeedbackLabel = BiasDimension | BiasSignal["category"] | AttributionType | "neutral_not_biased";

export interface DetectionFeedbackTarget {
  excerpt: string;
  context: string;
  modelLabel: FeedbackLabel;
  modelExplanation: string;
  modelConfidence: number | null;
  detectionType: FeedbackDetectionType;
  correctionOptions?: FeedbackLabel[];
  dimension?: BiasDimension;
  modelMetadata?: {
    provider: string;
    model: string;
    promptVersion: string;
  };
}

export interface FeedbackRecord {
  feedback_id: string;
  timestamp: string;
  created_at: string;
  revision: number;
  extension_version: string;
  page: {
    url: string;
    title: string;
  };
  detection: {
    detection_id: string;
    excerpt: string;
    context: string;
    model_label: FeedbackLabel;
    model_explanation: string;
    model_confidence: number | null;
    detection_type: FeedbackDetectionType;
  };
  user_feedback: {
    accuracy: FeedbackAccuracy;
    corrected_label: FeedbackLabel | null;
  };
  model_metadata: {
    provider: string;
    model: string;
    prompt_version: string;
  };
}

interface FeedbackEnvelope {
  schema_version: typeof FEEDBACK_SCHEMA_VERSION;
  records: FeedbackRecord[];
}

export interface FeedbackMetrics {
  totalReviewed: number;
  accurateCount: number;
  inaccurateCount: number;
  accuratePercentage: number;
  inaccuratePercentage: number;
  byModelLabel: FeedbackRateGroup[];
  byDetectionType: FeedbackRateGroup[];
  confusion: Array<{ modelLabel: string; correctedLabel: string; count: number }>;
  mostCorrectedLabels: Array<{ label: string; count: number }>;
  confidenceComparison: {
    lowConfidence: FeedbackRateGroup;
    higherConfidence: FeedbackRateGroup;
  };
}

export interface FeedbackRateGroup {
  label: string;
  total: number;
  inaccurateCount: number;
  inaccurateRate: number;
}

export interface FeedbackExport {
  schema_version: typeof FEEDBACK_SCHEMA_VERSION;
  exported_at: string;
  extension_version: string;
  summary: {
    total_feedback_records: number;
    accurate: number;
    inaccurate: number;
  };
  records: FeedbackRecord[];
}

export class FeedbackStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FeedbackStorageError";
  }
}

function hasChromeStorage() {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

function extensionVersion() {
  try {
    return typeof chrome !== "undefined" && chrome.runtime?.getManifest
      ? chrome.runtime.getManifest().version
      : "0.2.0";
  } catch {
    return "0.2.0";
  }
}

function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function bounded(value: string, max: number, preserveWhitespace = false) {
  const raw = String(value || "").trim();
  const text = preserveWhitespace ? raw : raw.replace(/\s+/g, " ");
  return text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`;
}

function clampConfidence(value: number | null) {
  if (value === null || !Number.isFinite(value)) return null;
  const normalized = value > 1 ? value / 100 : value;
  return Math.max(0, Math.min(1, normalized));
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function stableDetectionId(pageUrl: string, target: DetectionFeedbackTarget) {
  const identity = [
    pageUrl.trim().toLowerCase(),
    target.detectionType,
    target.modelLabel,
    target.excerpt.replace(/\s+/g, " ").trim().toLowerCase(),
    target.context.replace(/\s+/g, " ").trim().toLowerCase()
  ].join("|");
  return `detection_${stableHash(identity)}`;
}

export function feedbackLabel(value: string) {
  const labels: Record<string, string> = {
    political: "Political framing",
    gender: "Gender framing",
    ethnicity: "Ethnicity framing",
    class: "Class framing",
    loaded_language: "Loaded wording",
    epistemic_framing: "Certainty framing",
    persuasion: "Persuasive framing",
    stereotype_association: "Stereotype association",
    quoted: "Quoted source",
    paraphrased: "Paraphrased source",
    official_statement: "Official statement",
    anonymous_attribution: "Anonymous attribution",
    document_source: "Document or data source",
    declined_comment: "Declined comment",
    direct_quote: "Direct quote",
    denial: "Denial",
    mentioned_only: "Mentioned only",
    neutral_not_biased: "Neutral or not biased"
  };
  return labels[value] || value.replaceAll("_", " ");
}

export function modelMetadataFor(analysis: Analysis, dimension?: BiasDimension) {
  if (analysis.aiAnalysis) {
    const localSupport = analysis.aiAnalysis.localModelSupport && analysis.backendBias?.source !== "local-heuristic"
      ? ` + ${localModelName(dimension || "political")}`
      : "";
    return {
      provider: `${analysis.aiAnalysis.provider === "claude" ? "Claude Code" : "Codex"}${localSupport ? " with local Python support" : ""}`,
      model: `${analysis.aiAnalysis.model}${localSupport}`,
      prompt_version: "ellipsis-deep-analysis-v1"
    };
  }
  if (analysis.backendBias?.source === "hybrid-backend") {
    return {
      provider: "Local Python/FastAPI",
      model: localModelName(dimension || "political"),
      prompt_version: "ellipsis-hybrid-bias-v1"
    };
  }
  return {
    provider: "On-device local analysis",
    model: "Ellipsis source-linked heuristic rules",
    prompt_version: "ellipsis-local-bias-v1"
  };
}

function localModelName(dimension: BiasDimension) {
  const models: Record<BiasDimension, string> = {
    political: "mediabiasgroup/roberta-babe-ft",
    gender: "distilbert-base-uncased-finetuned-sst-2-english + Ellipsis gender association checks",
    ethnicity: "unitary/unbiased-toxic-roberta + distilbert-base-uncased-finetuned-sst-2-english",
    class: "Ellipsis source-linked class association checks"
  };
  return models[dimension];
}

export function buildFeedbackRecord(
  analysis: Analysis,
  target: DetectionFeedbackTarget,
  accuracy: FeedbackAccuracy,
  correctedLabel: FeedbackLabel | null,
  existing?: FeedbackRecord,
  now = new Date().toISOString()
): FeedbackRecord {
  const detectionId = stableDetectionId(analysis.url, target);
  return {
    feedback_id: existing?.feedback_id || `feedback_${randomId()}`,
    timestamp: now,
    created_at: existing?.created_at || now,
    revision: (existing?.revision || 0) + 1,
    extension_version: extensionVersion(),
    page: {
      url: bounded(analysis.url, 1200),
      title: bounded(analysis.pageTitle, 300)
    },
    detection: {
      detection_id: detectionId,
      excerpt: bounded(target.excerpt, 700, true),
      context: bounded(target.context, 1200, true),
      model_label: target.modelLabel,
      model_explanation: bounded(target.modelExplanation, 700),
      model_confidence: clampConfidence(target.modelConfidence),
      detection_type: target.detectionType
    },
    user_feedback: {
      accuracy,
      corrected_label: accuracy === "inaccurate" ? correctedLabel : null
    },
    model_metadata: target.modelMetadata
      ? {
          provider: target.modelMetadata.provider,
          model: target.modelMetadata.model,
          prompt_version: target.modelMetadata.promptVersion
        }
      : modelMetadataFor(analysis, target.dimension)
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const validAccuracies: FeedbackAccuracy[] = ["accurate", "inaccurate"];
const validDetectionTypes: FeedbackDetectionType[] = ["word", "phrase", "sentence", "explanation", "indicator"];
const validLabels: FeedbackLabel[] = [
  "political", "gender", "ethnicity", "class", "loaded_language", "epistemic_framing",
  "persuasion", "stereotype_association", "quoted", "paraphrased", "official_statement",
  "anonymous_attribution", "document_source", "declined_comment", "direct_quote", "denial",
  "mentioned_only", "neutral_not_biased"
];

export function isFeedbackRecord(value: unknown): value is FeedbackRecord {
  const record = value as FeedbackRecord | null;
  return Boolean(
    record && isString(record.feedback_id) && isString(record.timestamp) && isString(record.created_at) &&
    Number.isInteger(record.revision) && record.revision > 0 && isString(record.extension_version) &&
    isString(record.page?.url) && isString(record.page?.title) &&
    isString(record.detection?.detection_id) && isString(record.detection?.excerpt) &&
    typeof record.detection?.context === "string" && validLabels.includes(record.detection?.model_label) &&
    typeof record.detection?.model_explanation === "string" &&
    (record.detection?.model_confidence === null || (Number.isFinite(record.detection?.model_confidence) && record.detection.model_confidence >= 0 && record.detection.model_confidence <= 1)) &&
    validDetectionTypes.includes(record.detection?.detection_type) &&
    validAccuracies.includes(record.user_feedback?.accuracy) &&
    (record.user_feedback?.corrected_label === null || validLabels.includes(record.user_feedback?.corrected_label)) &&
    isString(record.model_metadata?.provider) && isString(record.model_metadata?.model) && isString(record.model_metadata?.prompt_version)
  );
}

export function parseFeedbackRecords(value: unknown) {
  const records = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as Partial<FeedbackEnvelope>).records)
      ? (value as Partial<FeedbackEnvelope>).records || []
      : [];
  return records.filter(isFeedbackRecord).slice(0, MAX_FEEDBACK_RECORDS);
}

async function readEnvelope(): Promise<FeedbackEnvelope> {
  try {
    let stored: unknown;
    if (hasChromeStorage()) {
      const result = await chrome.storage.local.get(FEEDBACK_STORAGE_KEY);
      stored = result[FEEDBACK_STORAGE_KEY];
    } else if (typeof window !== "undefined") {
      const raw = window.localStorage.getItem(FEEDBACK_STORAGE_KEY);
      stored = raw ? JSON.parse(raw) : undefined;
    }
    return { schema_version: FEEDBACK_SCHEMA_VERSION, records: parseFeedbackRecords(stored) };
  } catch (error) {
    throw new FeedbackStorageError("Saved feedback could not be read from this device.", { cause: error });
  }
}

async function writeEnvelope(records: FeedbackRecord[]) {
  const value: FeedbackEnvelope = {
    schema_version: FEEDBACK_SCHEMA_VERSION,
    records: records.slice(0, MAX_FEEDBACK_RECORDS)
  };
  try {
    if (hasChromeStorage()) {
      await chrome.storage.local.set({ [FEEDBACK_STORAGE_KEY]: value });
    } else if (typeof window !== "undefined") {
      window.localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(value));
    } else {
      throw new Error("Browser storage is unavailable.");
    }
  } catch (error) {
    throw new FeedbackStorageError("Feedback could not be saved on this device.", { cause: error });
  }
}

export async function getFeedbackRecords() {
  return (await readEnvelope()).records;
}

let mutationQueue: Promise<unknown> = Promise.resolve();

function queueMutation<T>(operation: () => Promise<T>): Promise<T> {
  const pending = mutationQueue.then(operation, operation);
  mutationQueue = pending.then(() => undefined, () => undefined);
  return pending;
}

export async function saveDetectionFeedback(
  analysis: Analysis,
  target: DetectionFeedbackTarget,
  accuracy: FeedbackAccuracy,
  correctedLabel: FeedbackLabel | null
) {
  return queueMutation(async () => {
    const current = await getFeedbackRecords();
    const detectionId = stableDetectionId(analysis.url, target);
    const existing = current.find((record) => record.detection.detection_id === detectionId);
    const record = buildFeedbackRecord(analysis, target, accuracy, correctedLabel, existing);
    const next = [record, ...current.filter((item) => item.detection.detection_id !== detectionId)].slice(0, MAX_FEEDBACK_RECORDS);
    await writeEnvelope(next);
    return { record, records: next, trimmed: !existing && current.length >= MAX_FEEDBACK_RECORDS };
  });
}

export async function deleteDetectionFeedback(detectionId: string) {
  return queueMutation(async () => {
    const current = await getFeedbackRecords();
    const next = current.filter((record) => record.detection.detection_id !== detectionId);
    await writeEnvelope(next);
    return next;
  });
}

export async function clearDetectionFeedback() {
  return queueMutation(async () => {
    await writeEnvelope([]);
    return [];
  });
}

function roundedPercentage(part: number, total: number) {
  return total ? Math.round((part / total) * 1000) / 10 : 0;
}

function groupedRates(records: FeedbackRecord[], key: (record: FeedbackRecord) => string) {
  const groups = new Map<string, { total: number; inaccurateCount: number }>();
  for (const record of records) {
    const label = key(record);
    const group = groups.get(label) || { total: 0, inaccurateCount: 0 };
    group.total += 1;
    if (record.user_feedback.accuracy === "inaccurate") group.inaccurateCount += 1;
    groups.set(label, group);
  }
  return Array.from(groups, ([label, group]): FeedbackRateGroup => ({
    label,
    ...group,
    inaccurateRate: roundedPercentage(group.inaccurateCount, group.total)
  })).sort((a, b) => b.inaccurateRate - a.inaccurateRate || b.total - a.total || a.label.localeCompare(b.label));
}

export function calculateFeedbackMetrics(records: FeedbackRecord[]): FeedbackMetrics {
  const valid = records.filter(isFeedbackRecord);
  const inaccurate = valid.filter((record) => record.user_feedback.accuracy === "inaccurate");
  const accurateCount = valid.length - inaccurate.length;
  const confusionCounts = new Map<string, number>();
  const correctedCounts = new Map<string, number>();
  for (const record of inaccurate) {
    const corrected = record.user_feedback.corrected_label;
    if (!corrected) continue;
    const key = `${record.detection.model_label}|${corrected}`;
    confusionCounts.set(key, (confusionCounts.get(key) || 0) + 1);
    correctedCounts.set(corrected, (correctedCounts.get(corrected) || 0) + 1);
  }
  const low = valid.filter((record) => record.detection.model_confidence !== null && record.detection.model_confidence < 0.6);
  const higher = valid.filter((record) => record.detection.model_confidence !== null && record.detection.model_confidence >= 0.6);
  const confidenceGroup = (label: string, group: FeedbackRecord[]): FeedbackRateGroup => {
    const inaccurateCount = group.filter((record) => record.user_feedback.accuracy === "inaccurate").length;
    return { label, total: group.length, inaccurateCount, inaccurateRate: roundedPercentage(inaccurateCount, group.length) };
  };
  return {
    totalReviewed: valid.length,
    accurateCount,
    inaccurateCount: inaccurate.length,
    accuratePercentage: roundedPercentage(accurateCount, valid.length),
    inaccuratePercentage: roundedPercentage(inaccurate.length, valid.length),
    byModelLabel: groupedRates(valid, (record) => record.detection.model_label),
    byDetectionType: groupedRates(valid, (record) => record.detection.detection_type),
    confusion: Array.from(confusionCounts, ([key, count]) => {
      const [modelLabel, correctedLabel] = key.split("|");
      return { modelLabel, correctedLabel, count };
    }).sort((a, b) => b.count - a.count),
    mostCorrectedLabels: Array.from(correctedCounts, ([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    confidenceComparison: {
      lowConfidence: confidenceGroup("Below 60% confidence", low),
      higherConfidence: confidenceGroup("60% confidence or higher", higher)
    }
  };
}

export function buildFeedbackExport(records: FeedbackRecord[], version = extensionVersion(), exportedAt = new Date().toISOString()): FeedbackExport {
  const valid = records.filter(isFeedbackRecord);
  const metrics = calculateFeedbackMetrics(valid);
  return {
    schema_version: FEEDBACK_SCHEMA_VERSION,
    exported_at: exportedAt,
    extension_version: version,
    summary: {
      total_feedback_records: metrics.totalReviewed,
      accurate: metrics.accurateCount,
      inaccurate: metrics.inaccurateCount
    },
    records: valid
  };
}

export function feedbackExportFilename(exportedAt = new Date()) {
  return `framecheck-feedback-${exportedAt.toISOString().slice(0, 10)}.json`;
}

export function downloadFeedbackExport(records: FeedbackRecord[]) {
  const exportedAt = new Date();
  const json = JSON.stringify(buildFeedbackExport(records, extensionVersion(), exportedAt.toISOString()), null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = feedbackExportFilename(exportedAt);
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return link.download;
}
