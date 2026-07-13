# Ellipsis local model helper

This required local FastAPI helper supplies the extension's three 1-100 bias scores from transformer/model-assisted signals. It is a development helper, not a hosted service.

## Run locally

From the repository root:

```sh
npm run backend:start
```

This creates or reuses `backend/.venv`, installs backend requirements, starts the helper on `127.0.0.1:8000`, stores Hugging Face downloads under `backend/.hf-cache`, and calls `/warmup` so the first extension analysis is less likely to hit a cold model.

Manual debugging command:

```sh
backend/.venv/bin/uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
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

The extension displays backend model scores directly. It still trims source passages locally so cited evidence and article highlights stay short and evidence-linked.

## API

```sh
curl -X POST http://127.0.0.1:8000/warmup
```

```sh
curl -X POST http://127.0.0.1:8000/analyze \
  -H "Content-Type: application/json" \
  -d '{"raw_text":"The mayor said critics failed to understand the policy."}'
```

The response contains political, gender, and ethnicity scores, linguistic evidence, and contextual review questions. Raw helper scores are never displayed as factuality or neutrality ratings.
