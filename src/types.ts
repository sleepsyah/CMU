export type ContentType = "article" | "bill" | "unsupported" | "unknown";
export type ConfidenceLabel = "High" | "Medium" | "Low";
export type FeedbackType = "Helpful" | "Confusing" | "Incorrect" | "Biased";
export type EvidenceKind = "source_text" | "outside_context" | "analysis_note";

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
  score: number;
  confidence: number;
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
  };
  contextual_analysis: {
    missing_perspectives: string[];
    stereotypical_associations: string[];
  };
  source: "hybrid-backend" | "local-fallback";
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
}

export interface ArticleAnalysis extends BaseAnalysis {
  contentType: "article";
  mainIssue: AnalysisFinding;
  framingNotes: AnalysisFinding[];
  loadedLanguageExamples: Array<AnalysisFinding & { phrase: string; context: string }>;
  quotedPeopleOrGroups: AnalysisFinding[];
  includedPerspectives: AnalysisFinding[];
  missingPerspectives: AnalysisFinding[];
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
