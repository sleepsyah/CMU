export type ContentType = "article" | "bill" | "unsupported" | "unknown";
export type ConfidenceLabel = "High" | "Medium" | "Low";
export type FeedbackType = "Helpful" | "Confusing" | "Incorrect" | "Biased";
export type EvidenceKind = "source_text" | "outside_context" | "analysis_note";
export type ArticleGenre = "event" | "opinion" | "data_report" | "explainer" | "investigation" | "general";
export type BiasDimension = "political" | "gender" | "ethnicity" | "class";
export type AiProvider = "codex" | "claude";
export type BiasMetricStatus = "assessed" | "insufficient-evidence";
export type FrameLabel =
  | "Economic"
  | "Capacity and resources"
  | "Morality"
  | "Fairness and equality"
  | "Legality and constitutionality"
  | "Policy prescription and evaluation"
  | "Crime and punishment"
  | "Security and defense"
  | "Health and safety"
  | "Quality of life"
  | "Cultural identity"
  | "Public opinion"
  | "Political"
  | "External regulation and reputation"
  | "Other";

export interface ExtractedPage {
  title: string;
  url: string;
  sourceName: string;
  /** Site icon the page declares, used to mark this outlet on the placement chart. Absent for pasted text. */
  iconUrl?: string;
  author: string;
  publishedAt: string;
  text: string;
  contentType: ContentType;
  links: Array<{ text: string; href: string }>;
}

export interface EvidenceItem {
  id: string;
  claim: string;
  supportingText: string;
  sourceUrl: string | null;
  sourceLabel: string;
  kind: EvidenceKind;
  explanation: string;
  confidenceScore: number;
  confidenceLabel: ConfidenceLabel;
}

export interface AnalysisFinding {
  text: string;
  evidenceIds: string[];
  confidenceScore: number;
  confidenceLabel: ConfidenceLabel;
}

export interface BiasMetric {
  score: number | null;
  confidence: number;
  evidenceCount: number;
  status: BiasMetricStatus;
}

export interface BiasSignal {
  id: string;
  dimension: BiasDimension;
  category: "loaded_language" | "epistemic_framing" | "persuasion" | "stereotype_association";
  phrase: string;
  context: string;
  explanation: string;
  neutralAlternative?: string;
  severity: 1 | 2 | 3;
}

export interface FrameSignal {
  id: string;
  label: FrameLabel;
  strength: number;
  explanation: string;
  evidenceIds: string[];
  source: "heuristic" | "local-codex" | "local-ai";
}

export interface FramingProfile {
  dominantFrames: FrameSignal[];
}

export type SourceEntityType = "person" | "government" | "organization" | "media" | "anonymous_source" | "document";
export type SourceRole = "quoted" | "paraphrased" | "official_statement" | "anonymous_attribution" | "document_source" | "declined_comment";
export type AttributionType = SourceRole | "direct_quote" | "denial" | "mentioned_only";

export interface SourceEvidence {
  evidenceText: string;
  sourceSpan?: string;
  quotedText?: string;
  sentenceIndex?: number;
  blockId?: string;
  attributionType: AttributionType;
}

export interface ArticleSource {
  canonicalId: string;
  displayName: string;
  canonicalName?: string;
  aliases: string[];
  entityType: SourceEntityType;
  affiliation?: string;
  sourceRoles: SourceRole[];
  contributionSummary: string;
  evidence: SourceEvidence[];
  reportedVia?: string[];
  mentionCount: number;
}

export interface AttributionEvent extends SourceEvidence {
  actor: string;
  claim: string;
  sourceRole?: SourceRole;
  reportingIntermediary?: string;
  mentionedOnly: boolean;
}

export interface SourceExtractionDiagnostic {
  sourceSpan: string;
  evidenceSpan: string;
  canonicalizationResult?: string;
  attributionClassification?: AttributionType;
  decision: "accepted" | "repaired" | "rejected";
  reason: string;
}

export interface SourceCoverage {
  processedCharacterCount: number;
  totalCharacterCount: number;
  blockCount: number;
  skippedBlockCount: number;
  skippedCharacterCount: number;
  skipped: boolean;
  truncated: boolean;
}

export type FactCheckStatus = "supported" | "contradicted" | "unresolved" | "context_needed";

export interface FactCheck {
  id: string;
  claim: string;
  status: FactCheckStatus;
  explanation: string;
  sourceText: string;
  citations: Array<{
    url: string;
    label: string;
    evidence: string;
  }>;
}

export interface VocabularyTerm {
  term: string;
  meaning: string;
  evidenceIds: string[];
}

export interface AiAnalysis {
  source: "local-codex" | "local-ai";
  provider?: AiProvider;
  model: string;
  reasoningEffort: string;
  summaryEvidenceIds: string[];
  confidenceScore: number;
  confidenceReason: string;
  addedSignalCount: number;
  addedFrameCount: number;
  addedFindingCount: number;
  outsideContextCount: number;
  reasoningSummaryCount: number;
  runtimeMs: number;
  summaryRefined: boolean;
  webSearchCount: number;
  localModelSupport?: boolean;
  outputSummary?: string;
  factChecks?: FactCheck[];
  researchSourceCount?: number;
  reasoningSummaries?: string[];
  webSearchQueries?: string[];
  analyzedAt: string;
}

export type AnalysisTraceKind = "local" | "plan" | "reasoning" | "tool" | "validation" | "runtime";
export type AnalysisTraceStatus = "pending" | "running" | "completed" | "failed";

export interface AnalysisTraceEvent {
  runId: string;
  id: string;
  kind: AnalysisTraceKind;
  status: AnalysisTraceStatus;
  title: string;
  detail?: string;
  at: string;
  startedAt?: string;
  parentId?: string;
  durationMs?: number;
}

export interface AiSettings {
  enabled: boolean;
  provider: AiProvider;
  connectionVerifiedAt: string | null;
}

export interface AiConnectionStatus {
  provider: AiProvider;
  providerStatus: "ready" | "needs_auth" | "unavailable";
  providerMessage: string;
  model: string;
  reasoningEffort: string;
  runtime: string;
  version?: string | null;
  checkedAt: string;
}

export interface AiLoginResult {
  status: AiConnectionStatus;
  authUrl?: string;
  loginId?: string | null;
  loginStarted?: boolean;
}

export type CodexConnectionStatus = AiConnectionStatus;
export type CodexLoginResult = AiLoginResult;

export interface TargetDependentAsymmetry {
  target: string;
  associated_verbs: string[];
}

export interface BackendBiasAnalysis {
  scores: {
    political_bias: BiasMetric;
    gender_bias: BiasMetric;
    ethnicity_bias: BiasMetric;
    class_bias: BiasMetric;
  };
  linguistic_evidence: {
    spin_words_detected: string[];
    target_dependent_asymmetries: TargetDependentAsymmetry[];
    counterfactual_sentiment_delta: number;
    signals: BiasSignal[];
  };
  contextual_analysis: {
    stereotypical_associations: string[];
  };
  source: "hybrid-backend" | "local-heuristic" | "local-fallback" | "codex-enhanced" | "ai-enhanced";
}

export interface BiasProfile {
  score: number;
  level: "minimal" | "low" | "moderate" | "high";
  summary: string;
}

export interface OutletCoverageEstimate {
  status: "estimated" | "limited" | "unavailable";
  outletHost: string;
  topicLabel: string;
  topicTerms: string[];
  windowDays: number;
  relatedCount: number;
  sampledArticleCount: number;
  percentage: number | null;
  method: string;
  sampledUrls: string[];
  generatedAt: string;
  note: string;
}

export type OutletProfileOrigin = "bundled-dataset" | "ai-research";

export interface OutletCitation {
  url: string;
  label: string;
}

/**
 * Both scores come from published datasets, never from Ellipsis or from AI
 * research. An outlet absent from those datasets has a null placement rather
 * than an estimated one.
 *
 * `quality` is 0-100, from the Lin et al. (2023) principal component across six
 * expert rating sets. `partisanship` is -100 (shared mainly by registered
 * Democrats) to +100 (Republicans), from the Yang et al. (2025) DomainDemo
 * panel. Partisanship describes a US sharing audience, not editorial stance.
 */
export interface OutletPlacement {
  quality: number;
  partisanship: number;
  note: string;
}

export interface OutletProfile {
  host: string;
  name: string;
  origin: OutletProfileOrigin;
  headquarters: string;
  country: string;
  ownership: string;
  funding: string;
  founded: string;
  medium: string;
  /** Packaged asset path for bundled outlets, page-declared URL for researched ones. */
  icon: string | null;
  placement: OutletPlacement | null;
  citations: OutletCitation[];
  generatedAt: string;
}

export interface OutletReferencePoint {
  name: string;
  host: string;
  quality: number;
  partisanship: number;
  icon: string | null;
}

export interface BaseAnalysis {
  id: string;
  url: string;
  pageTitle: string;
  sourceName: string;
  author: string;
  publishedAt: string;
  contentType: ContentType;
  summary: string;
  confidenceScore: number;
  confidenceReason: string;
  summaryEvidenceIds: string[];
  createdAt: string;
  evidence: EvidenceItem[];
  vocabularyTerms?: VocabularyTerm[];
  backendBias?: BackendBiasAnalysis;
  biasProfile?: BiasProfile;
  outletCoverage?: OutletCoverageEstimate;
  outletProfile?: OutletProfile;
  aiAnalysis?: AiAnalysis;
  aiFailureReason?: string;
}

export interface ArticleAnalysis extends BaseAnalysis {
  contentType: "article";
  genre: ArticleGenre;
  mainIssue: AnalysisFinding;
  framingNotes: AnalysisFinding[];
  loadedLanguageExamples: Array<AnalysisFinding & { phrase: string; context: string }>;
  sourcesAndVoices: ArticleSource[];
  sourceSummary: string;
  sourceEvents: AttributionEvent[];
  sourceCoverage: SourceCoverage;
  framingProfile: FramingProfile;
}

export interface BillAnalysis extends BaseAnalysis {
  contentType: "bill";
  billNumber: string;
  billTitle: string;
  mainIssue: AnalysisFinding;
  plainLanguageSummary: string;
  proposedChanges: AnalysisFinding[];
  affectedGroups: AnalysisFinding[];
  sourcedSupporters: AnalysisFinding[];
  sourcedOpponents: AnalysisFinding[];
  unclearImpacts: AnalysisFinding[];
  importantTerms: Array<AnalysisFinding & { term: string; meaning: string }>;
}

export type Analysis = ArticleAnalysis | BillAnalysis;

export interface SavedAnalysis {
  id: string;
  url: string;
  pageTitle: string;
  contentType: ContentType;
  createdAt: string;
  summary: string;
  confidenceScore: number;
  analysis: Analysis;
}

export interface FeedbackLog {
  id: string;
  analysisId: string;
  url: string;
  contentType: ContentType;
  feedbackType: FeedbackType;
  optionalComment: string;
  confidenceScore: number;
  createdAt: string;
}
