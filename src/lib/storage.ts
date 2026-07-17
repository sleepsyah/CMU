import type { AiSettings, Analysis, AnalysisFinding, ArticleAnalysis, ArticleSource, AttributionEvent, BackendBiasAnalysis, BiasMetric, ConfidenceLabel, EvidenceItem, FeedbackLog, SavedAnalysis, SourceEvidence } from "../types";
import { validateSourceDisplayName } from "./sources";

const HISTORY_KEY = "ellipsis.savedAnalyses";
const FEEDBACK_KEY = "ellipsis.feedbackLogs";
const AI_SETTINGS_KEY = "ellipsis.aiSettings";
const LEGACY_STORAGE_PREFIX = ["un", "framed"].join("");
const LEGACY_HISTORY_KEY = `${LEGACY_STORAGE_PREFIX}.savedAnalyses`;
const LEGACY_FEEDBACK_KEY = `${LEGACY_STORAGE_PREFIX}.feedbackLogs`;
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

function migrateSourceEvidence(value: unknown): SourceEvidence {
  const item = (value || {}) as Partial<SourceEvidence> & { text?: string };
  const legacyType = String(item.attributionType || "paraphrased");
  const attributionType = legacyType === "data_provider" ? "document_source" : legacyType === "reporting_intermediary" ? "paraphrased" : item.attributionType || "paraphrased";
  return {
    evidenceText: item.evidenceText || item.text || "",
    ...(item.sourceSpan ? { sourceSpan: item.sourceSpan } : {}),
    ...(item.quotedText ? { quotedText: item.quotedText } : {}),
    ...(typeof item.sentenceIndex === "number" ? { sentenceIndex: item.sentenceIndex } : {}),
    ...(item.blockId ? { blockId: item.blockId } : {}),
    attributionType
  };
}

function migrateArticleSource(value: unknown): ArticleSource | null {
  const item = (value || {}) as Partial<ArticleSource>;
  const evidence = Array.isArray(item.evidence) ? item.evidence.map(migrateSourceEvidence).filter((entry) => entry.evidenceText) : [];
  if (!evidence.length) return null;
  const validated = validateSourceDisplayName(String(item.displayName || item.canonicalName || ""), evidence[0]?.evidenceText || "");
  if (!validated.name) return null;
  const aliases = Array.from(new Set([...(Array.isArray(item.aliases) ? item.aliases : []), validated.name]
    .map((alias) => validateSourceDisplayName(String(alias), evidence[0]?.evidenceText || "").name)
    .filter((alias): alias is string => Boolean(alias))));
  const legacyRoles = (Array.isArray(item.sourceRoles) ? item.sourceRoles : [])
    .map((role) => String(role) === "data_provider" ? "document_source" : role)
    .filter((role) => String(role) !== "reporting_intermediary") as ArticleSource["sourceRoles"];
  const entityType = String(item.entityType) === "data_source" ? "document" : item.entityType || "organization";
  return {
    canonicalId: item.canonicalId || `source-${validated.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    displayName: validated.name,
    canonicalName: validated.name,
    aliases,
    entityType,
    sourceRoles: legacyRoles,
    contributionSummary: item.contributionSummary || "Provided information explicitly attributed by the article.",
    evidence,
    ...(item.affiliation ? { affiliation: item.affiliation } : {}),
    ...(Array.isArray(item.reportedVia) && item.reportedVia.length ? { reportedVia: item.reportedVia } : {}),
    mentionCount: typeof item.mentionCount === "number" ? item.mentionCount : evidence.length
  };
}

function migrateSourceEvent(value: unknown): AttributionEvent | null {
  const item = (value || {}) as Partial<AttributionEvent> & { text?: string };
  const evidence = migrateSourceEvidence(item);
  const validated = validateSourceDisplayName(String(item.actor || item.sourceSpan || ""), evidence.evidenceText);
  if (!validated.name) return null;
  return {
    ...evidence,
    actor: validated.name,
    claim: item.claim || evidence.evidenceText,
    sourceRole: item.sourceRole,
    reportingIntermediary: item.reportingIntermediary,
    mentionedOnly: Boolean(item.mentionedOnly)
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
      ethnicity_bias: migrateMetric(value.scores.ethnicity_bias),
      class_bias: migrateMetric(value.scores.class_bias)
    },
    linguistic_evidence: {
      spin_words_detected: value.linguistic_evidence?.spin_words_detected || [],
      target_dependent_asymmetries: value.linguistic_evidence?.target_dependent_asymmetries || [],
      counterfactual_sentiment_delta: value.linguistic_evidence?.counterfactual_sentiment_delta || 0,
      signals: value.linguistic_evidence?.signals || []
    },
    contextual_analysis: {
      stereotypical_associations: value.contextual_analysis?.stereotypical_associations || []
    }
  };
}

export function migrateSavedAnalysis(value: SavedAnalysis): SavedAnalysis | null {
  const legacy = value?.analysis as Analysis | undefined;
  if (!legacy || (legacy.contentType !== "article" && legacy.contentType !== "bill")) return null;
  const {
    quotedPeopleOrGroups: _legacyQuoted,
    perspectiveSources: _legacyPerspectiveSources,
    includedPerspectives: _legacyIncluded,
    missingPerspectives: _legacyMissing,
    ...legacyBase
  } = legacy as Analysis & Record<string, unknown>;
  const common = {
    ...legacyBase,
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
        sourcesAndVoices: ((legacy as ArticleAnalysis).sourcesAndVoices || [])
          .map(migrateArticleSource)
          .filter((item): item is ArticleSource => Boolean(item))
          .slice(0, 8),
        sourceSummary: (legacy as ArticleAnalysis).sourceSummary || "",
        sourceEvents: (legacy.sourceEvents || []).map(migrateSourceEvent).filter((item): item is AttributionEvent => Boolean(item)),
        sourceCoverage: legacy.sourceCoverage || {
          processedCharacterCount: 0,
          totalCharacterCount: 0,
          blockCount: 0,
          skippedBlockCount: 0,
          skippedCharacterCount: 0,
          skipped: false,
          truncated: false
        },
        framingProfile: { dominantFrames: legacy.framingProfile?.dominantFrames || [] }
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

async function readMigratedValue<T>(key: string, legacyKey: string, fallback: T): Promise<T> {
  const current = await readValue<T | null>(key, null);
  if (current !== null) return current;
  const legacy = await readValue<T | null>(legacyKey, null);
  if (legacy === null) return fallback;
  await writeValue(key, legacy);
  return legacy;
}

export async function getSavedAnalyses() {
  const saved = await readMigratedValue<SavedAnalysis[]>(HISTORY_KEY, LEGACY_HISTORY_KEY, []);
  return Array.isArray(saved) ? saved.map(migrateSavedAnalysis).filter((item): item is SavedAnalysis => Boolean(item)) : [];
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
  const logs = await readMigratedValue<FeedbackLog[]>(FEEDBACK_KEY, LEGACY_FEEDBACK_KEY, []);
  return Array.isArray(logs) ? logs : [];
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

export async function getAiSettings(): Promise<AiSettings> {
  let value = await readValue<Partial<AiSettings> | null>(AI_SETTINGS_KEY, null);
  if (!value) {
    if (hasChromeStorage()) {
      const stored = await chrome.storage.local.get(null);
      const migrated = Object.entries(stored).find(([key, item]) => key !== AI_SETTINGS_KEY && key.endsWith(".aiSettings") && typeof item === "object" && item !== null)?.[1] as Partial<AiSettings> | undefined;
      value = migrated || null;
    } else {
      for (let index = 0; index < window.localStorage.length && !value; index += 1) {
        const key = window.localStorage.key(index);
        if (!key || key === AI_SETTINGS_KEY || !key.endsWith(".aiSettings")) continue;
        const raw = window.localStorage.getItem(key);
        if (raw) value = JSON.parse(raw) as Partial<AiSettings>;
      }
    }
    if (value) await writeValue(AI_SETTINGS_KEY, value);
  }
  return {
    enabled: value?.enabled === true,
    provider: value?.provider === "claude" ? "claude" : "codex",
    connectionVerifiedAt: typeof value?.connectionVerifiedAt === "string" ? value.connectionVerifiedAt : null
  };
}

export async function saveAiSettings(settings: AiSettings): Promise<AiSettings> {
  const value = {
    enabled: settings.enabled === true,
    provider: settings.provider === "claude" ? "claude" as const : "codex" as const,
    connectionVerifiedAt: settings.connectionVerifiedAt || null
  };
  await writeValue(AI_SETTINGS_KEY, value);
  return value;
}
