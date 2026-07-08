export type ContentType = "article" | "bill" | "unsupported" | "unknown";
export type ConfidenceLabel = "High" | "Medium" | "Low";
export type FeedbackType = "Helpful" | "Confusing" | "Incorrect" | "Biased";

export interface ExtractedPage {
  title: string;
  url: string;
  sourceName: string;
  text: string;
  contentType: ContentType;
  links: Array<{ text: string; href: string }>;
}

export interface EvidenceItem {
  id: string;
  claim: string;
  supportingText: string;
  sourceUrl: string;
  explanation: string;
  confidenceScore: number;
  confidenceLabel: ConfidenceLabel;
}

export interface BaseAnalysis {
  id: string;
  url: string;
  pageTitle: string;
  sourceName: string;
  contentType: ContentType;
  summary: string;
  confidenceScore: number;
  confidenceReason: string;
  createdAt: string;
  evidence: EvidenceItem[];
}

export interface ArticleAnalysis extends BaseAnalysis {
  contentType: "article";
  mainIssue: string;
  framingNotes: string[];
  loadedLanguageExamples: Array<{ phrase: string; context: string }>;
  quotedPeopleOrGroups: string[];
  includedPerspectives: string[];
  missingPerspectives: string[];
}

export interface BillAnalysis extends BaseAnalysis {
  contentType: "bill";
  billNumber: string;
  billTitle: string;
  mainIssue: string;
  plainLanguageSummary: string;
  proposedChanges: string[];
  affectedGroups: string[];
  sourcedSupporters: string[];
  sourcedOpponents: string[];
  unclearImpacts: string[];
  importantTerms: Array<{ term: string; meaning: string }>;
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
