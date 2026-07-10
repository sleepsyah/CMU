# Ellipsis local model helper

This optional FastAPI service combines local transformer outputs with the extension's evidence-linked heuristics. It is a development helper, not a hosted service.

## Run locally

From the repository root:

```sh
python3 -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements.txt
pip install -r backend/requirements-ml.txt
uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Optional dependency parsing:

```sh
pip install -r backend/requirements-spacy.txt
python -m spacy download en_core_web_sm
```

Build the extension with the helper URL explicitly set:

```sh
PUBLIC_ELLIPSIS_BACKEND_URL=http://127.0.0.1:8000 npm run build
```

The frontend rejects non-loopback helper URLs. The helper has no remote LLM path.

## Models and boundaries

- `mediabiasgroup/roberta-babe-ft` is applied to sentences for lexical media-bias cues. It is not used as a factuality or political-leaning classifier.
- `distilbert-base-uncased-finetuned-sst-2-english` supplies a limited counterfactual sentiment signal only for sentences containing a relevant group reference.
- `unitary/unbiased-toxic-roberta` is restricted to demographic-context sentences and is treated as a supporting signal, not an ethnicity classifier.
- Optional spaCy parsing can identify uneven verbs or adjectives associated with named entities.

The extension only incorporates a model score when its local analysis has direct evidence for that dimension. Dimensions without evidence remain unassessed.

## API

```sh
curl -X POST http://127.0.0.1:8000/analyze \
  -H "Content-Type: application/json" \
  -d '{"raw_text":"The mayor said critics failed to understand the policy."}'
```

The response contains political, gender, and ethnicity scores, linguistic evidence, and contextual review questions. Raw helper scores are never displayed as factuality or neutrality ratings.
