import type { Analysis, AnalysisFinding, BackendBiasAnalysis, BiasMetric, ConfidenceLabel, EvidenceItem, FeedbackLog, SavedAnalysis } from "../types";

const HISTORY_KEY = "unframed.savedAnalyses";
const FEEDBACK_KEY = "unframed.feedbackLogs";
const MAX_HISTORY = 50;

function confidenceLabel(score: number): ConfidenceLabel {
  if (score >= 75) return "High";
  if (score >= 50) return "Medium";
  return "Low";
}

function migrateFinding(value: unknown): AnalysisFinding {
  if (typeof value === "string") {
    return { text: value, evidenceIds: [], confidenceScore: 35, confidenceLabel: "Low" };
  }
  const item = (value || {}) as Partial<AnalysisFinding> & { phrase?: string; context?: string };
  const score = typeof item.confidenceScore === "number" ? item.confidenceScore : 35;
  return {
    text: item.text || item.context || item.phrase || "Unverified legacy finding",
    evidenceIds: Array.isArray(item.evidenceIds) ? item.evidenceIds : [],
    confidenceScore: score,
    confidenceLabel: item.confidenceLabel || confidenceLabel(score)
  };
}

function migrateEvidence(value: EvidenceItem, sourceName: string): EvidenceItem {
  const url = typeof value.sourceUrl === "string" && /^https?:\/\//.test(value.sourceUrl) ? value.sourceUrl : null;
  return {
    ...value,
    sourceUrl: url,
    sourceLabel: value.sourceLabel || (url ? sourceName : "Legacy analysis note"),
    kind: value.kind || (url ? "source_text" : "analysis_note"),
    confidenceLabel: value.confidenceLabel || confidenceLabel(value.confidenceScore)
  };
}

function migrateMetric(value: Partial<BiasMetric> | undefined): BiasMetric {
  const score = typeof value?.score === "number" && Number.isFinite(value.score) ? value.score : null;
  const evidenceCount = typeof value?.evidenceCount === "number" ? value.evidenceCount : score === null ? 0 : 1;
  return {
    score,
    confidence: typeof value?.confidence === "number" ? value.confidence : 0.35,
    evidenceCount,
    status: value?.status || (score === null ? "insufficient-evidence" : "assessed")
  };
}

function migrateBackendBias(value: BackendBiasAnalysis | undefined): BackendBiasAnalysis | undefined {
  if (!value?.scores) return undefined;
  return {
    ...value,
    scores: {
      political_bias: migrateMetric(value.scores.political_bias),
      gender_bias: migrateMetric(value.scores.gender_bias),
      ethnicity_bias: migrateMetric(value.scores.ethnicity_bias)
    },
    linguistic_evidence: {
      spin_words_detected: value.linguistic_evidence?.spin_words_detected || [],
      target_dependent_asymmetries: value.linguistic_evidence?.target_dependent_asymmetries || [],
      counterfactual_sentiment_delta: value.linguistic_evidence?.counterfactual_sentiment_delta || 0,
      signals: value.linguistic_evidence?.signals || []
    },
    contextual_analysis: {
      missing_perspectives: value.contextual_analysis?.missing_perspectives || [],
      stereotypical_associations: value.contextual_analysis?.stereotypical_associations || []
    }
  };
}

export function migrateSavedAnalysis(value: SavedAnalysis): SavedAnalysis | null {
  const legacy = value?.analysis as Analysis | undefined;
  if (!legacy || (legacy.contentType !== "article" && legacy.contentType !== "bill")) return null;
  const common = {
    ...legacy,
    author: legacy.author || "",
    publishedAt: legacy.publishedAt || "",
    summaryEvidenceIds: Array.isArray(legacy.summaryEvidenceIds) ? legacy.summaryEvidenceIds : [],
    evidence: Array.isArray(legacy.evidence) ? legacy.evidence.map((item) => migrateEvidence(item, legacy.sourceName)) : [],
    backendBias: migrateBackendBias(legacy.backendBias),
    mainIssue: migrateFinding(legacy.mainIssue)
  };
  const analysis: Analysis = legacy.contentType === "article"
    ? {
        ...common,
        contentType: "article",
        genre: legacy.genre || "general",
        framingNotes: (legacy.framingNotes || []).map(migrateFinding),
        loadedLanguageExamples: (legacy.loadedLanguageExamples || []).map((item) => ({
          ...migrateFinding(item),
          phrase: item.phrase,
          context: item.context
        })),
        quotedPeopleOrGroups: (legacy.quotedPeopleOrGroups || []).map(migrateFinding),
        includedPerspectives: (legacy.includedPerspectives || []).map(migrateFinding),
        missingPerspectives: (legacy.missingPerspectives || []).map(migrateFinding)
      }
    : {
        ...common,
        contentType: "bill",
        billNumber: legacy.billNumber,
        billTitle: legacy.billTitle,
        plainLanguageSummary: legacy.plainLanguageSummary,
        proposedChanges: (legacy.proposedChanges || []).map(migrateFinding),
        affectedGroups: (legacy.affectedGroups || []).map(migrateFinding),
        sourcedSupporters: (legacy.sourcedSupporters || []).map(migrateFinding),
        sourcedOpponents: (legacy.sourcedOpponents || []).map(migrateFinding),
        unclearImpacts: (legacy.unclearImpacts || []).map(migrateFinding),
        importantTerms: (legacy.importantTerms || []).map((item) => ({
          ...migrateFinding(item),
          term: item.term,
          meaning: item.meaning
        }))
      };
  return { ...value, analysis };
}

function hasChromeStorage() {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

async function readValue<T>(key: string, fallback: T): Promise<T> {
  if (hasChromeStorage()) {
    const result = await chrome.storage.local.get(key);
    return (result[key] as T | undefined) ?? fallback;
  }
  const raw = window.localStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T) : fallback;
}

async function writeValue<T>(key: string, value: T): Promise<void> {
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [key]: value });
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

export async function getSavedAnalyses() {
  const saved = await readValue<SavedAnalysis[]>(HISTORY_KEY, []);
  return saved.map(migrateSavedAnalysis).filter((item): item is SavedAnalysis => Boolean(item));
}

export async function saveAnalysis(item: SavedAnalysis, confirmDelete: () => boolean) {
  const current = await getSavedAnalyses();
  const withoutDuplicate = current.filter((saved) => saved.id !== item.id);

  if (withoutDuplicate.length >= MAX_HISTORY && !confirmDelete()) {
    return { saved: false, count: withoutDuplicate.length };
  }

  const next = [item, ...withoutDuplicate].slice(0, MAX_HISTORY);
  await writeValue(HISTORY_KEY, next);
  return { saved: true, count: next.length };
}

export async function deleteSavedAnalysis(id: string) {
  const current = await getSavedAnalyses();
  const next = current.filter((item) => item.id !== id);
  await writeValue(HISTORY_KEY, next);
  return next;
}

export async function clearSavedAnalyses() {
  await writeValue(HISTORY_KEY, []);
  return [];
}

export async function getFeedbackLogs() {
  return readValue<FeedbackLog[]>(FEEDBACK_KEY, []);
}

export async function clearFeedbackLogs() {
  await writeValue(FEEDBACK_KEY, []);
  return [];
}

export async function logFeedback(feedback: FeedbackLog) {
  const current = await getFeedbackLogs();
  const next = [feedback, ...current].slice(0, 250);
  await writeValue(FEEDBACK_KEY, next);
  return next;
}
