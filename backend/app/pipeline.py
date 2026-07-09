from __future__ import annotations

from .config import Settings
from .llm_audit import run_contextual_audit
from .model_registry import ModelRegistry
from .schemas import BiasAnalysisResponse, BiasScore, ContextualAnalysis, LinguisticEvidence, Scores
from .text_utils import clamp, normalize_score, token_count
from .tier1 import Tier1Metrics, run_tier1


async def analyze_text_bias(raw_text: str, registry: ModelRegistry, settings: Settings) -> BiasAnalysisResponse:
    """Execute the two-tier hybrid multi-model bias pipeline."""

    text = raw_text.strip()[: settings.max_text_chars]
    tier1 = await run_tier1(text, registry)
    contextual = await run_contextual_audit(text, tier1, settings)
    scores = compile_scores(text, tier1, contextual)

    return BiasAnalysisResponse(
        scores=scores,
        linguistic_evidence=LinguisticEvidence(
            spin_words_detected=tier1.spin_words_detected,
            target_dependent_asymmetries=tier1.target_dependent_asymmetries,
            counterfactual_sentiment_delta=round(tier1.counterfactual_sentiment_delta, 4),
        ),
        contextual_analysis=contextual,
    )


def compile_scores(raw_text: str, tier1: Tier1Metrics, contextual: ContextualAnalysis) -> Scores:
    """Normalize model outputs to the requested 1-100 bias scales."""

    political_context = clamp(
        (len(contextual.missing_perspectives) * 0.13)
        + (0.12 if any("informational parity" in item.lower() for item in contextual.missing_perspectives) else 0.0),
        0.0,
        1.0,
    )
    stereotype_context = clamp(len(contextual.stereotypical_associations) * 0.16, 0.0, 1.0)

    political = weighted_sum(
        [
            (tier1.political_classifier_score, 0.38),
            (tier1.spin_density, 0.24),
            (tier1.tdsa_asymmetry_delta, 0.20),
            (political_context, 0.18),
        ]
    )
    gender = weighted_sum(
        [
            (tier1.gender_counterfactual_delta, 0.32),
            (tier1.coref_stereotype_score, 0.28),
            (tier1.gender_language_score, 0.16),
            (stereotype_context, 0.16),
            (tier1.toxicity_score, 0.08),
        ]
    )
    ethnicity = weighted_sum(
        [
            (tier1.ethnicity_counterfactual_delta, 0.28),
            (tier1.coded_hostility_score, 0.24),
            (tier1.toxicity_score, 0.18),
            (stereotype_context, 0.20),
            (tier1.tdsa_asymmetry_delta, 0.10),
        ]
    )

    return Scores(
        political_bias=BiasScore(score=normalize_score(political), confidence=confidence_for(raw_text, tier1, "political")),
        gender_bias=BiasScore(score=normalize_score(gender), confidence=confidence_for(raw_text, tier1, "gender")),
        ethnicity_bias=BiasScore(score=normalize_score(ethnicity), confidence=confidence_for(raw_text, tier1, "ethnicity")),
    )


def weighted_sum(values: list[tuple[float, float]]) -> float:
    total_weight = sum(weight for _, weight in values) or 1.0
    return clamp(sum(clamp(value, 0.0, 1.0) * weight for value, weight in values) / total_weight, 0.0, 1.0)


def confidence_for(raw_text: str, tier1: Tier1Metrics, dimension: str) -> float:
    base = tier1.confidence
    if dimension == "political" and tier1.political_classifier_score > 0:
        base += 0.04
    if dimension == "gender" and (tier1.gender_counterfactual_delta > 0 or tier1.coref_stereotype_score > 0):
        base += 0.04
    if dimension == "ethnicity" and (tier1.ethnicity_counterfactual_delta > 0 or tier1.coded_hostility_score > 0):
        base += 0.04
    if token_count(raw_text) < 120:
        base -= 0.14
    return round(clamp(base, 0.35, 0.96), 2)
