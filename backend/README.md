# Unframed Hybrid Bias Backend

FastAPI backend for the two-tier bias pipeline used by the Chrome extension.

## Run Locally

```sh
cd "/Users/sarahzhou/Documents/CMU bias detector"
python3 -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements.txt
pip install -r backend/requirements-ml.txt
uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Optional spaCy dependency parsing:

```sh
pip install -r backend/requirements-spacy.txt
python -m spacy download en_core_web_sm
```

## Models

- Political lexical bias: `mediabiasgroup/roberta-babe-ft`, a RoBERTa model fine-tuned on BABE-style lexical bias labels.
- Counterfactual sentiment: `distilbert-base-uncased-finetuned-sst-2-english`.
- Toxicity and coded hostility: `unitary/unbiased-toxic-roberta`, trained on Jigsaw toxicity and unintended-bias data.
- Gendered coreference stereotype hook: set `COREF_BIAS_MODEL` to a Hugging Face classifier fine-tuned on WinoBias or WinoGender.

WinoBias/WinoGender are useful for gendered occupation/pronoun stereotype patterns. They are not a strong ethnicity-bias detector, so ethnicity scoring uses demographic counterfactual sentiment, identity-hostility/toxicity, negative association framing, and contextual audit flags.

## Optional LLM Audit

By default, `LLM_PROVIDER=none` uses a deterministic contextual audit. To enable the async OpenAI audit:

```sh
export LLM_PROVIDER=openai
export OPENAI_API_KEY=...
export LLM_MODEL=gpt-4o
```

## API

```sh
curl -X POST http://127.0.0.1:8000/analyze \
  -H "Content-Type: application/json" \
  -d '{"raw_text":"The mayor boasted that critics failed to understand the policy."}'
```

The response shape is:

```json
{
  "scores": {
    "political_bias": { "score": 45, "confidence": 0.89 },
    "gender_bias": { "score": 12, "confidence": 0.94 },
    "ethnicity_bias": { "score": 78, "confidence": 0.85 }
  },
  "linguistic_evidence": {
    "spin_words_detected": ["boasted", "failed"],
    "target_dependent_asymmetries": [
      { "target": "Person A", "associated_verbs": ["asserts", "commands"] }
    ],
    "counterfactual_sentiment_delta": 0.32
  },
  "contextual_analysis": {
    "missing_perspectives": ["..."],
    "stereotypical_associations": ["..."]
  }
}
```
