# Ellipsis local model helper

This optional FastAPI service supplies evidence-linked local transformer signals to Codex when AI deep analysis is enabled. It is a development helper, not a hosted service or a requirement for normal extension use.

## Run locally

From the repository root:

```sh
npm run backend:start
```

This creates or reuses `backend/.venv`, installs the model requirements, starts the helper on `127.0.0.1:8000`, and warms the supporting models.

Optional dependency parsing:

```sh
pip install -r backend/requirements-spacy.txt
python -m spacy download en_core_web_sm
```

The default helper address is loopback. To use a different loopback port, build with:

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
