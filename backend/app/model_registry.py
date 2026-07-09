from __future__ import annotations

import logging
from functools import cached_property
from typing import Any

from .config import Settings

logger = logging.getLogger(__name__)


class ModelRegistry:
    """Lazy loader for optional heavyweight NLP models."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.availability: dict[str, bool] = {}

    @cached_property
    def spacy_nlp(self) -> Any | None:
        try:
            import spacy

            nlp = spacy.load(self.settings.spacy_model)
            self.availability["spacy_dependency"] = True
            return nlp
        except Exception as exc:  # pragma: no cover - depends on local install
            logger.warning("spaCy parser unavailable: %s", exc)
            self.availability["spacy_dependency"] = False
            return None

    @cached_property
    def political_classifier(self) -> Any | None:
        return self._load_text_classifier("political_classifier", self.settings.political_bias_model)

    @cached_property
    def sentiment_classifier(self) -> Any | None:
        return self._load_text_classifier("sentiment_classifier", self.settings.sentiment_model)

    @cached_property
    def toxicity_classifier(self) -> Any | None:
        return self._load_text_classifier("toxicity_classifier", self.settings.toxicity_model)

    @cached_property
    def coref_bias_classifier(self) -> Any | None:
        if not self.settings.coref_bias_model:
            self.availability["coref_bias_classifier"] = False
            return None
        return self._load_text_classifier("coref_bias_classifier", self.settings.coref_bias_model)

    def _load_text_classifier(self, key: str, model_name: str) -> Any | None:
        try:
            from transformers import pipeline

            classifier = pipeline("text-classification", model=model_name, truncation=True, top_k=None)
            self.availability[key] = True
            return classifier
        except Exception as exc:  # pragma: no cover - depends on network/cache
            logger.warning("%s unavailable for %s: %s", key, model_name, exc)
            self.availability[key] = False
            return None


def classifier_score(output: Any, positive_labels: set[str]) -> float:
    """Convert a Hugging Face classifier output into a 0..1 positive severity."""

    if isinstance(output, list) and output and isinstance(output[0], list):
        output = output[0]
    if isinstance(output, list):
        scores = []
        for item in output:
            label = str(item.get("label", "")).lower()
            if label in positive_labels or any(token in label for token in positive_labels):
                scores.append(float(item.get("score", 0.0)))
        return max(scores) if scores else 0.0
    if isinstance(output, dict):
        label = str(output.get("label", "")).lower()
        score = float(output.get("score", 0.0))
        return score if label in positive_labels or any(token in label for token in positive_labels) else 1.0 - score
    return 0.0
