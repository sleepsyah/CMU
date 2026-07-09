from __future__ import annotations

import re
from dataclasses import dataclass, field

from .model_registry import ModelRegistry, classifier_score
from .schemas import TargetDependentAsymmetry
from .text_utils import (
    DEMOGRAPHIC_TERMS,
    ETHNICITY_MUTATIONS,
    GENDER_BIAS_TERMS,
    GENDER_MUTATIONS,
    NEGATIVE_ASSOCIATION_TERMS,
    clamp,
    lexical_spin_hits,
    mutate_demographics,
    sentences,
    simple_sentiment_score,
    token_count,
    weighted_density,
)


@dataclass
class Tier1Metrics:
    spin_words_detected: list[str] = field(default_factory=list)
    spin_density: float = 0.0
    political_classifier_score: float = 0.0
    target_dependent_asymmetries: list[TargetDependentAsymmetry] = field(default_factory=list)
    tdsa_asymmetry_delta: float = 0.0
    gender_counterfactual_delta: float = 0.0
    ethnicity_counterfactual_delta: float = 0.0
    counterfactual_sentiment_delta: float = 0.0
    coref_stereotype_score: float = 0.0
    gender_language_score: float = 0.0
    toxicity_score: float = 0.0
    coded_hostility_score: float = 0.0
    confidence: float = 0.45


async def run_tier1(raw_text: str, registry: ModelRegistry) -> Tier1Metrics:
    metrics = Tier1Metrics()
    text = raw_text.strip()
    scan_political_tokens(text, metrics, registry)
    extract_dependency_asymmetries(text, metrics, registry)
    run_counterfactual_mutation(text, metrics, registry)
    run_coref_stereotype_check(text, metrics, registry)
    run_toxicity_filter(text, metrics, registry)
    metrics.confidence = tier1_confidence(text, registry)
    return metrics


def scan_political_tokens(text: str, metrics: Tier1Metrics, registry: ModelRegistry) -> None:
    hits = lexical_spin_hits(text)
    metrics.spin_words_detected = sorted({word for word, _ in hits})
    metrics.spin_density = weighted_density(hits, token_count(text))
    classifier = registry.political_classifier
    if classifier is None:
        return
    try:
        outputs = classifier(text[:4000])
        metrics.political_classifier_score = classifier_score(outputs, {"1", "label_1", "biased", "bias", "lexical-bias"})
    except Exception:
        metrics.political_classifier_score = 0.0


def extract_dependency_asymmetries(text: str, metrics: Tier1Metrics, registry: ModelRegistry) -> None:
    nlp = registry.spacy_nlp
    if nlp is None:
        fallback_dependency_asymmetries(text, metrics)
        return
    doc = nlp(text[:12000])
    target_verbs: dict[str, list[str]] = {}
    target_valences: dict[str, list[float]] = {}
    for ent in doc.ents:
        if ent.label_ not in {"PERSON", "ORG", "NORP", "GPE"}:
            continue
        verbs: list[str] = []
        valences: list[float] = []
        root = ent.root
        for token in doc:
            bound_to_target = token.head == root or root.head == token or token.head == root.head
            if bound_to_target and token.pos_ in {"VERB", "ADJ"}:
                verbs.append(token.lemma_.lower())
                valences.append(lexical_valence(token.lemma_))
        if verbs:
            target = ent.text.strip()
            target_verbs.setdefault(target, []).extend(verbs[:8])
            target_valences.setdefault(target, []).extend(valences)
    metrics.target_dependent_asymmetries = [
        TargetDependentAsymmetry(target=target, associated_verbs=sorted(set(verbs))[:8])
        for target, verbs in target_verbs.items()
        if not generic_target(target)
    ][:8]
    metrics.tdsa_asymmetry_delta = asymmetry_delta(target_valences)


def fallback_dependency_asymmetries(text: str, metrics: Tier1Metrics) -> None:
    target_pattern = re.compile(r"\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b")
    verb_pattern = re.compile(r"\b(asserts|commands|evades|clings|admits|boasted|conceded|claims|failed|attacked|praised)\b", re.I)
    target_verbs: dict[str, list[str]] = {}
    target_valences: dict[str, list[float]] = {}
    for sentence in sentences(text):
        targets = [target for target in target_pattern.findall(sentence) if not generic_target(target)]
        verbs = [match.group(0).lower() for match in verb_pattern.finditer(sentence)]
        for target in targets[:2]:
            if verbs:
                target_verbs.setdefault(target, []).extend(verbs[:5])
                target_valences.setdefault(target, []).extend(lexical_valence(verb) for verb in verbs[:5])
    metrics.target_dependent_asymmetries = [
        TargetDependentAsymmetry(target=target, associated_verbs=sorted(set(verbs))[:8])
        for target, verbs in target_verbs.items()
    ][:8]
    metrics.tdsa_asymmetry_delta = asymmetry_delta(target_valences)


def generic_target(target: str) -> bool:
    return target.strip().lower() in {"the", "a", "an", "this", "that", "section"}


def lexical_valence(term: str) -> float:
    negative = {"evade", "evades", "cling", "clings", "failed", "attack", "attacked", "conceded", "corrupt"}
    positive = {"praised", "commands", "asserts", "succeeded", "effective"}
    lower = term.lower()
    if lower in negative:
        return -1.0
    if lower in positive:
        return 1.0
    return 0.0


def asymmetry_delta(target_valences: dict[str, list[float]]) -> float:
    means = [sum(values) / len(values) for values in target_valences.values() if values]
    if len(means) < 2:
        return 0.0
    return clamp((max(means) - min(means)) / 2.0, 0.0, 1.0)


def run_counterfactual_mutation(text: str, metrics: Tier1Metrics, registry: ModelRegistry) -> None:
    original = sentiment_score(text, registry)
    gender_text = mutate_demographics(text, GENDER_MUTATIONS)
    ethnicity_text = mutate_demographics(text, ETHNICITY_MUTATIONS)
    metrics.gender_counterfactual_delta = abs(original - sentiment_score(gender_text, registry))
    metrics.ethnicity_counterfactual_delta = abs(original - sentiment_score(ethnicity_text, registry))
    metrics.counterfactual_sentiment_delta = max(metrics.gender_counterfactual_delta, metrics.ethnicity_counterfactual_delta)


def sentiment_score(text: str, registry: ModelRegistry) -> float:
    classifier = registry.sentiment_classifier
    if classifier is None:
        return simple_sentiment_score(text)
    try:
        outputs = classifier(text[:4000])
        return classifier_score(outputs, {"positive", "pos", "label_1"})
    except Exception:
        return simple_sentiment_score(text)


def run_coref_stereotype_check(text: str, metrics: Tier1Metrics, registry: ModelRegistry) -> None:
    classifier = registry.coref_bias_classifier
    if classifier is not None:
        try:
            outputs = classifier(text[:4000])
            metrics.coref_stereotype_score = classifier_score(outputs, {"biased", "stereotype", "label_1"})
        except Exception:
            metrics.coref_stereotype_score = 0.0
    stereotype_patterns = [
        r"\b(nurse|teacher|assistant|secretary)\b.{0,80}\b(she|her)\b",
        r"\b(engineer|programmer|executive|surgeon|scientist)\b.{0,80}\b(he|him|his)\b",
    ]
    pattern_hits = sum(1 for pattern in stereotype_patterns if re.search(pattern, text, flags=re.I | re.S))
    gendered_language_hits = sum(1 for term in GENDER_BIAS_TERMS if re.search(rf"\b{re.escape(term)}\b", text, flags=re.I))
    metrics.gender_language_score = clamp(gendered_language_hits / 5.0, 0.0, 1.0)
    metrics.coref_stereotype_score = max(metrics.coref_stereotype_score, clamp(pattern_hits / 2.0, 0.0, 1.0), metrics.gender_language_score)


def run_toxicity_filter(text: str, metrics: Tier1Metrics, registry: ModelRegistry) -> None:
    classifier = registry.toxicity_classifier
    if classifier is not None:
        try:
            outputs = classifier(text[:4000])
            metrics.toxicity_score = classifier_score(outputs, {"toxic", "toxicity", "identity_attack", "label_1"})
        except Exception:
            metrics.toxicity_score = 0.0
    metrics.coded_hostility_score = coded_hostility_score(text)


def coded_hostility_score(text: str) -> float:
    lower = text.lower()
    demographic_mentions = sum(1 for term in DEMOGRAPHIC_TERMS if re.search(rf"\b{re.escape(term)}\b", lower))
    negative_mentions = sum(1 for term in NEGATIVE_ASSOCIATION_TERMS if re.search(rf"\b{re.escape(term)}\b", lower))
    if demographic_mentions == 0:
        return 0.0
    return clamp((negative_mentions / max(1, demographic_mentions)) / 3.0, 0.0, 1.0)


def tier1_confidence(text: str, registry: ModelRegistry) -> float:
    availability_bonus = sum(0.08 for available in registry.availability.values() if available)
    length_bonus = 0.12 if token_count(text) > 250 else 0.0
    return clamp(0.46 + availability_bonus + length_bonus, 0.35, 0.94)
