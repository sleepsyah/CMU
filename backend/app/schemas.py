from pydantic import BaseModel, ConfigDict, Field


class BiasScore(BaseModel):
    model_config = ConfigDict(extra="forbid")

    score: int = Field(ge=1, le=100)
    confidence: float = Field(ge=0.0, le=1.0)


class Scores(BaseModel):
    model_config = ConfigDict(extra="forbid")

    political_bias: BiasScore
    gender_bias: BiasScore
    ethnicity_bias: BiasScore


class TargetDependentAsymmetry(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target: str
    associated_verbs: list[str] = Field(default_factory=list)


class LinguisticEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    spin_words_detected: list[str] = Field(default_factory=list)
    target_dependent_asymmetries: list[TargetDependentAsymmetry] = Field(default_factory=list)
    counterfactual_sentiment_delta: float = Field(ge=0.0, le=1.0)


class ContextualAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stereotypical_associations: list[str] = Field(default_factory=list)


class BiasAnalysisResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scores: Scores
    linguistic_evidence: LinguisticEvidence
    contextual_analysis: ContextualAnalysis


class BiasAnalysisRequest(BaseModel):
    raw_text: str = Field(min_length=1, max_length=120000)


BIAS_ANALYSIS_JSON_SCHEMA = BiasAnalysisResponse.model_json_schema()
