from __future__ import annotations

from functools import lru_cache
from typing import Literal, Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime model settings."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    political_bias_model: str = "mediabiasgroup/roberta-babe-ft"
    sentiment_model: str = "distilbert-base-uncased-finetuned-sst-2-english"
    toxicity_model: str = "unitary/unbiased-toxic-roberta"
    coref_bias_model: Optional[str] = None
    spacy_model: str = "en_core_web_sm"

    llm_provider: Literal["none", "openai"] = "none"
    llm_model: str = "gpt-4o"
    openai_api_key: Optional[str] = None
    llm_timeout_seconds: float = 30.0

    max_text_chars: int = 24000


@lru_cache
def get_settings() -> Settings:
    return Settings()
