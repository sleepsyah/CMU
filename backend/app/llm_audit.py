from __future__ import annotations

import re

from .config import Settings
from .schemas import ContextualAnalysis
from .tier1 import Tier1Metrics
from .text_utils import DEMOGRAPHIC_TERMS, NEGATIVE_ASSOCIATION_TERMS, sentences


async def run_contextual_audit(raw_text: str, tier1: Tier1Metrics, settings: Settings) -> ContextualAnalysis:
    """Run the local deterministic contextual audit."""

    _ = settings
    return heuristic_contextual_audit(raw_text, tier1)


def heuristic_contextual_audit(raw_text: str, tier1: Tier1Metrics) -> ContextualAnalysis:
    lower = raw_text.lower()
    missing: list[str] = []
    stereotypes: list[str] = []

    if tier1.spin_density > 0.18 or tier1.political_classifier_score > 0.6:
        missing.append("Check whether the article provides enough factual context for its loaded or lexical-bias wording.")

    perspective_terms = {"supporter", "opponent", "critic", "advocate", "expert", "researcher", "official"}
    present_perspectives = [term for term in perspective_terms if re.search(rf"\b{term}s?\b", lower)]
    if len(present_perspectives) <= 1:
        missing.append("Would another relevant source or primary record materially change this account?")

    if tier1.tdsa_asymmetry_delta > 0.25:
        missing.append("Do named targets receive meaningfully different verb or adjective framing?")

    demographic_sentences = [
        sentence
        for sentence in sentences(raw_text)
        if any(re.search(rf"\b{re.escape(term)}\b", sentence, flags=re.I) for term in DEMOGRAPHIC_TERMS)
    ]
    for sentence in demographic_sentences[:8]:
        has_negative_frame = any(
            re.search(rf"\b{re.escape(term)}\b", sentence, flags=re.I) for term in NEGATIVE_ASSOCIATION_TERMS
        )
        negated = re.search(r"\b(not|never|no evidence|without evidence|rejects?|denies?)\b", sentence, flags=re.I)
        if has_negative_frame and not negated and tier1.coded_hostility_score > 0:
            stereotypes.append(sentence[:260])

    if tier1.coref_stereotype_score > 0.35:
        stereotypes.append("A gender reference appears in the same sentence as a stereotyped descriptor.")
    if tier1.coded_hostility_score > 0.2 or tier1.toxicity_score > 0.45:
        stereotypes.append("At least one identity term is directly paired with hostile or negative context.")

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
