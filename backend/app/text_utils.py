from __future__ import annotations

import math
import re
from collections.abc import Iterable


SPIN_WORD_WEIGHTS: dict[str, float] = {
    "boasted": 1.0,
    "conceded": 0.8,
    "gloating": 1.0,
    "radical": 0.95,
    "extreme": 0.85,
    "corrupt": 1.0,
    "dangerous": 0.85,
    "reckless": 0.85,
    "weaponized": 0.8,
    "slam": 0.75,
    "blasted": 0.8,
    "disastrous": 0.9,
    "devastating": 0.8,
    "outrage": 0.75,
    "betrayal": 0.85,
    "secretive": 0.7,
    "clings": 0.7,
    "evades": 0.85,
}

GENDER_BIAS_TERMS = {
    "abrasive",
    "bossy",
    "emotional",
    "hysterical",
    "shrill",
    "appearance",
    "outfit",
    "hair",
    "pretty",
    "motherly",
    "aggressive",
}

NEGATIVE_ASSOCIATION_TERMS = {
    "crime",
    "criminal",
    "gang",
    "gangs",
    "violent",
    "violence",
    "poverty",
    "poor",
    "incompetent",
    "lazy",
    "threat",
    "terror",
    "illegal",
    "fraud",
    "invasion",
    "unqualified",
}

GENDER_MUTATIONS = {
    "he": "she",
    "him": "her",
    "his": "her",
    "himself": "herself",
    "man": "woman",
    "men": "women",
    "male": "female",
    "father": "mother",
    "husband": "wife",
    "john": "mary",
    "michael": "sarah",
    "robert": "lisa",
}

ETHNICITY_MUTATIONS = {
    "black": "white",
    "white": "black",
    "asian": "latino",
    "asians": "latinos",
    "latino": "asian",
    "latinos": "asians",
    "latina": "asian",
    "latinas": "asians",
    "hispanic": "white",
    "hispanics": "white people",
    "arab": "white",
    "muslim": "christian",
    "muslims": "christians",
    "jewish": "christian",
    "immigrant": "citizen",
    "immigrants": "citizens",
    "native american": "white",
}

DEMOGRAPHIC_TERMS = set(GENDER_MUTATIONS) | set(ETHNICITY_MUTATIONS)


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def normalize_score(value: float) -> int:
    return int(round(clamp(1.0 + (99.0 * value), 1.0, 100.0)))


def sentences(text: str, limit: int = 80) -> list[str]:
    normalized = re.sub(r"\s+", " ", text).strip()
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"'])", normalized)
    return [part.strip() for part in parts if len(part.strip()) > 12][:limit]


def token_count(text: str) -> int:
    return max(1, len(re.findall(r"\b[\w'-]+\b", text)))


def lexical_spin_hits(text: str) -> list[tuple[str, float]]:
    hits: list[tuple[str, float]] = []
    lower = text.lower()
    for word, weight in SPIN_WORD_WEIGHTS.items():
        for _ in re.finditer(rf"\b{re.escape(word)}\b", lower):
            hits.append((word, weight))
    return hits


def weighted_density(hits: Iterable[tuple[str, float]], total_tokens: int, scale: float = 75.0) -> float:
    weighted = sum(weight for _, weight in hits)
    return clamp((weighted / total_tokens) * scale, 0.0, 1.0)


def mutate_demographics(text: str, mutation_map: dict[str, str]) -> str:
    mutated = text
    for source in sorted(mutation_map, key=len, reverse=True):
        target = mutation_map[source]
        mutated = re.sub(
            rf"\b{re.escape(source)}\b",
            lambda match: _preserve_case(match.group(0), target),
            mutated,
            flags=re.IGNORECASE,
        )
    return mutated


def _preserve_case(source: str, target: str) -> str:
    if source.isupper():
        return target.upper()
    if source[:1].isupper():
        return target.capitalize()
    return target


def simple_sentiment_score(text: str) -> float:
    positive = {"capable", "effective", "qualified", "trusted", "successful", "safe", "honest", "strong"}
    negative = {"failed", "weak", "dangerous", "criminal", "corrupt", "incompetent", "lazy", "threat", "violent"}
    words = [word.lower() for word in re.findall(r"\b[\w'-]+\b", text)]
    raw = sum(1 for word in words if word in positive) - sum(1 for word in words if word in negative)
    return 1.0 / (1.0 + math.exp(-raw / 4.0))
