from __future__ import annotations

import json
import re

from .config import Settings
from .schemas import ContextualAnalysis
from .tier1 import Tier1Metrics
from .text_utils import DEMOGRAPHIC_TERMS, NEGATIVE_ASSOCIATION_TERMS, sentences


async def run_contextual_audit(raw_text: str, tier1: Tier1Metrics, settings: Settings) -> ContextualAnalysis:
    """Run the optional deep contextual audit, with a deterministic fallback."""

    if settings.llm_provider == "openai" and settings.openai_api_key:
        result = await run_openai_contextual_audit(raw_text, tier1, settings)
        if result is not None:
            return result
    return heuristic_contextual_audit(raw_text, tier1)


async def run_openai_contextual_audit(
    raw_text: str,
    tier1: Tier1Metrics,
    settings: Settings,
) -> ContextualAnalysis | None:
    try:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(api_key=settings.openai_api_key, timeout=settings.llm_timeout_seconds)
        response = await client.chat.completions.create(
            model=settings.llm_model,
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You audit news or bill text for structural bias. Return only JSON with "
                        "missing_perspectives and stereotypical_associations arrays. Be cautious: "
                        "mentioning a demographic group is not bias by itself."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "article_text": raw_text[: settings.max_text_chars],
                            "tier1_metrics": {
                                "spin_words_detected": tier1.spin_words_detected,
                                "tdsa_asymmetry_delta": tier1.tdsa_asymmetry_delta,
                                "counterfactual_sentiment_delta": tier1.counterfactual_sentiment_delta,
                                "gender_counterfactual_delta": tier1.gender_counterfactual_delta,
                                "ethnicity_counterfactual_delta": tier1.ethnicity_counterfactual_delta,
                                "toxicity_score": tier1.toxicity_score,
                                "coded_hostility_score": tier1.coded_hostility_score,
                            },
                        }
                    ),
                },
            ],
        )
        content = response.choices[0].message.content or "{}"
        parsed = json.loads(content)
        return ContextualAnalysis(
            missing_perspectives=list(parsed.get("missing_perspectives", []))[:6],
            stereotypical_associations=list(parsed.get("stereotypical_associations", []))[:6],
        )
    except Exception:
        return None


def heuristic_contextual_audit(raw_text: str, tier1: Tier1Metrics) -> ContextualAnalysis:
    lower = raw_text.lower()
    missing: list[str] = []
    stereotypes: list[str] = []

    if tier1.spin_density > 0.18 or tier1.political_classifier_score > 0.6:
        missing.append("Loaded or lexical-bias wording is present; check whether opposing factual context is represented.")

    perspective_terms = {"supporter", "opponent", "critic", "advocate", "expert", "researcher", "official"}
    present_perspectives = [term for term in perspective_terms if re.search(rf"\b{term}s?\b", lower)]
    if len(present_perspectives) <= 1:
        missing.append("The extracted text shows a narrow source base, so informational parity may be limited.")

    if tier1.tdsa_asymmetry_delta > 0.25:
        missing.append("Named targets appear to receive uneven verb or adjective framing in the extracted sentences.")

    demographic_sentences = [
        sentence
        for sentence in sentences(raw_text)
        if any(re.search(rf"\b{re.escape(term)}\b", sentence, flags=re.I) for term in DEMOGRAPHIC_TERMS)
    ]
    for sentence in demographic_sentences[:8]:
        has_negative_frame = any(
            re.search(rf"\b{re.escape(term)}\b", sentence, flags=re.I) for term in NEGATIVE_ASSOCIATION_TERMS
        )
        if has_negative_frame:
            stereotypes.append(sentence[:260])

    if tier1.coref_stereotype_score > 0.35:
        stereotypes.append("Gendered occupation or pronoun patterns resemble WinoBias/WinoGender stereotype templates.")
    if tier1.coded_hostility_score > 0.2 or tier1.toxicity_score > 0.45:
        stereotypes.append("Identity terms are paired with hostile or negative context more often than expected.")

    return ContextualAnalysis(
        missing_perspectives=dedupe(missing)[:6],
        stereotypical_associations=dedupe(stereotypes)[:6],
    )


def dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        cleaned = value.strip()
        if cleaned and cleaned not in seen:
            seen.add(cleaned)
            result.append(cleaned)
    return result
