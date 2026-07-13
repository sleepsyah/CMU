export type ContentType = "article" | "bill" | "unsupported" | "unknown";
export type ConfidenceLabel = "High" | "Medium" | "Low";
export type FeedbackType = "Helpful" | "Confusing" | "Incorrect" | "Biased";
export type EvidenceKind = "source_text" | "outside_context" | "analysis_note";
export type ArticleGenre = "event" | "opinion" | "data_report" | "explainer" | "investigation" | "general";
export type BiasDimension = "political" | "gender" | "ethnicity";
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
  source: "heuristic" | "local-codex";
}

export interface FramingProfile {
  dominantFrames: FrameSignal[];
  namedSourceCount: number;
  attributedPerspectiveCount: number;
  reviewQuestions: AnalysisFinding[];
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

export interface AiAnalysis {
  source: "local-codex";
  model: "gpt-5.5";
  reasoningEffort: "low";
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
  connectionVerifiedAt: string | null;
}

export interface CodexConnectionStatus {
  providerStatus: "ready" | "needs_auth" | "unavailable";
  providerMessage: string;
  model: "gpt-5.5";
  reasoningEffort: "low";
  runtime: string;
  checkedAt: string;
}

export interface CodexLoginResult {
  status: CodexConnectionStatus;
  authUrl?: string;
  loginId?: string | null;
}

export interface TargetDependentAsymmetry {
  target: string;
  associated_verbs: string[];
}

export interface BackendBiasAnalysis {
  scores: {
    political_bias: BiasMetric;
    gender_bias: BiasMetric;
    ethnicity_bias: BiasMetric;
  };
  linguistic_evidence: {
    spin_words_detected: string[];
    target_dependent_asymmetries: TargetDependentAsymmetry[];
    counterfactual_sentiment_delta: number;
    signals: BiasSignal[];
  };
  contextual_analysis: {
    missing_perspectives: string[];
    stereotypical_associations: string[];
  };
  source: "hybrid-backend" | "local-heuristic" | "local-fallback" | "codex-enhanced";
}

export interface BiasProfile {
  score: number;
  level: "minimal" | "low" | "moderate" | "high";
  summary: string;
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
  backendBias?: BackendBiasAnalysis;
  biasProfile?: BiasProfile;
  aiAnalysis?: AiAnalysis;
  aiFailureReason?: string;
}

export interface ArticleAnalysis extends BaseAnalysis {
  contentType: "article";
  genre: ArticleGenre;
  mainIssue: AnalysisFinding;
  framingNotes: AnalysisFinding[];
  loadedLanguageExamples: Array<AnalysisFinding & { phrase: string; context: string }>;
  quotedPeopleOrGroups: AnalysisFinding[];
  includedPerspectives: AnalysisFinding[];
  missingPerspectives: AnalysisFinding[];
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
