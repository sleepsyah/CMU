import { analyzePage, confidenceLabel } from "./analysis";
import type { Analysis, BackendBiasAnalysis, BiasMetric, EvidenceItem, ExtractedPage } from "../types";

const BACKEND_URL = import.meta.env.PUBLIC_UNFRAMED_BACKEND_URL || "http://127.0.0.1:8000";

type BackendPayload = Omit<BackendBiasAnalysis, "source">;

export async function analyzePageWithBackend(page: ExtractedPage): Promise<Analysis> {
  const localAnalysis = analyzePage(page);

  try {
    const backendBias = await fetchBackendBias(page.text);
    return attachBackendBias(localAnalysis, { ...backendBias, source: "hybrid-backend" });
  } catch {
    return attachBackendBias(localAnalysis, localFallbackBias(page.text));
  }
}

async function fetchBackendBias(rawText: string): Promise<BackendPayload> {
  const response = await fetch(`${BACKEND_URL}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw_text: rawText })
  });
  if (!response.ok) {
    throw new Error(`Backend analysis failed with ${response.status}`);
  }
  return response.json() as Promise<BackendPayload>;
}

function attachBackendBias(analysis: Analysis, backendBias: BackendBiasAnalysis): Analysis {
  const biasEvidence = buildBiasEvidence(analysis.url, backendBias);
  return {
    ...analysis,
    backendBias,
    evidence: [...analysis.evidence, ...biasEvidence]
  } as Analysis;
}

function buildBiasEvidence(sourceUrl: string, backendBias: BackendBiasAnalysis): EvidenceItem[] {
  const maxScore = Math.max(
    backendBias.scores.political_bias.score,
    backendBias.scores.gender_bias.score,
    backendBias.scores.ethnicity_bias.score
  );
  const supportingText = [
    backendBias.linguistic_evidence.spin_words_detected.length
      ? `Spin words: ${backendBias.linguistic_evidence.spin_words_detected.slice(0, 8).join(", ")}.`
      : "No high-weight spin words were returned by the backend.",
    backendBias.contextual_analysis.stereotypical_associations[0] || backendBias.contextual_analysis.missing_perspectives[0] || ""
  ]
    .filter(Boolean)
    .join(" ");

  return [
    {
      id: `ev_bias_${Date.now().toString(36)}`,
      claim: "Hybrid backend bias meters generated.",
      supportingText,
      sourceUrl,
      sourceLabel: backendBias.source === "hybrid-backend" ? "Unframed hybrid backend" : "Unframed local fallback",
      kind: "analysis_note",
      explanation:
        backendBias.source === "hybrid-backend"
          ? "Scores combine BABE RoBERTa political-bias classification, counterfactual sentiment shifts, dependency/coreference signals, and contextual audit flags."
          : "The local backend was unavailable, so the extension used a lightweight local approximation.",
      confidenceScore: Math.round(Math.max(35, Math.min(96, averageConfidence(backendBias) * 100))),
      confidenceLabel: confidenceLabel(Math.round(Math.max(35, Math.min(96, averageConfidence(backendBias) * 100))))
    }
  ];
}

function averageConfidence(backendBias: BackendBiasAnalysis) {
  const values = [
    backendBias.scores.political_bias.confidence,
    backendBias.scores.gender_bias.confidence,
    backendBias.scores.ethnicity_bias.confidence
  ];
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function localFallbackBias(text: string): BackendBiasAnalysis {
  const lower = text.toLowerCase();
  const spinWords = [
    "radical",
    "extreme",
    "corrupt",
    "dangerous",
    "reckless",
    "weaponized",
    "disastrous",
    "devastating",
    "betrayal",
    "boasted",
    "conceded"
  ].filter((word) => new RegExp(`\\b${word}\\b`, "i").test(text));
  const genderTerms = ["bossy", "emotional", "hysterical", "shrill", "motherly", "appearance"].filter((word) => lower.includes(word));
  const ethnicityTerms = ["crime", "criminal", "violent", "gang", "terror", "illegal", "invasion"].filter((word) => lower.includes(word));

  return {
    source: "local-fallback",
    scores: {
      political_bias: fallbackMetric(spinWords.length * 11),
      gender_bias: fallbackMetric(genderTerms.length * 14),
      ethnicity_bias: fallbackMetric(ethnicityTerms.length * 12)
    },
    linguistic_evidence: {
      spin_words_detected: spinWords,
      target_dependent_asymmetries: [],
      counterfactual_sentiment_delta: 0
    },
    contextual_analysis: {
      missing_perspectives: spinWords.length ? ["Loaded wording is present; compare against the cited evidence and source balance."] : [],
      stereotypical_associations: [...genderTerms, ...ethnicityTerms].length
        ? ["Potential demographic framing terms were detected by the local fallback."]
        : []
    }
  };
}

function fallbackMetric(rawScore: number): BiasMetric {
  return {
    score: Math.max(1, Math.min(100, 8 + rawScore)),
    confidence: 0.42
  };
}
