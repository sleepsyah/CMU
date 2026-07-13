from __future__ import annotations

import asyncio

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings, get_settings
from .model_registry import ModelRegistry
from .pipeline import analyze_text_bias
from .schemas import BiasAnalysisRequest, BiasAnalysisResponse

app = FastAPI(title="Ellipsis Bias Pipeline", version="0.2.0")
REQUIRED_MODEL_KEYS = ("political_classifier", "sentiment_classifier", "toxicity_classifier")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["chrome-extension://*", "http://localhost:*", "http://127.0.0.1:*"],
    allow_origin_regex=r"^(chrome-extension://.*|http://(localhost|127\.0\.0\.1):\d+)$",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def get_registry(settings: Settings = Depends(get_settings)) -> ModelRegistry:
    if not hasattr(app.state, "model_registry"):
        app.state.model_registry = ModelRegistry(settings)
    return app.state.model_registry


@app.get("/health")
async def health(registry: ModelRegistry = Depends(get_registry)) -> dict[str, object]:
    ready = all(registry.availability.get(key) is True for key in REQUIRED_MODEL_KEYS)
    return {"status": "ok", "ready": ready, "required_models": list(REQUIRED_MODEL_KEYS), "models": registry.availability}


@app.post("/warmup")
async def warmup(registry: ModelRegistry = Depends(get_registry)) -> dict[str, object]:
    availability = await asyncio.to_thread(registry.warmup)
    ready = all(availability.get(key) is True for key in REQUIRED_MODEL_KEYS)
    return {"status": "ready" if ready else "partial", "ready": ready, "required_models": list(REQUIRED_MODEL_KEYS), "models": availability}


@app.post("/analyze", response_model=BiasAnalysisResponse)
async def analyze(
    request: BiasAnalysisRequest,
    settings: Settings = Depends(get_settings),
    registry: ModelRegistry = Depends(get_registry),
) -> BiasAnalysisResponse:
    return await analyze_text_bias(request.raw_text, registry, settings)
