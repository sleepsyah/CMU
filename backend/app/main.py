from __future__ import annotations

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings, get_settings
from .model_registry import ModelRegistry
from .pipeline import analyze_text_bias
from .schemas import BiasAnalysisRequest, BiasAnalysisResponse

app = FastAPI(title="Unframed Bias Pipeline", version="0.2.0")

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
    return {"status": "ok", "models": registry.availability}


@app.post("/analyze", response_model=BiasAnalysisResponse)
async def analyze(
    request: BiasAnalysisRequest,
    settings: Settings = Depends(get_settings),
    registry: ModelRegistry = Depends(get_registry),
) -> BiasAnalysisResponse:
    return await analyze_text_bias(request.raw_text, registry, settings)
