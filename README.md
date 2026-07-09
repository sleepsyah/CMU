# unframed

unframed is a Chrome side-panel extension prototype. It helps readers review news articles and Congress.gov bills for framing, evidence, missing perspectives, and uncertainty.

## Test In Chrome

1. Start the optional hybrid backend if you want the model-powered bias meters:

```sh
python3 -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements.txt
pip install -r backend/requirements-ml.txt
uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

2. Build the extension:

```sh
npm install
npm test
npm run build
```

3. Open Chrome and go to `chrome://extensions`.
4. Turn on **Developer mode**.
5. Click **Load unpacked**.
6. Select:

```text
/Users/sarahzhou/Documents/CMU bias detector/dist
```

7. Open a specific news article or Congress.gov bill page.
8. Click the unframed extension icon.
9. Click **Analyze** in the side panel.

If the page cannot be extracted, paste article or bill text into **Manual Paste** and click **Analyze pasted text**.

## Test After Code Changes (NON-AGENTS can ignore)

Run:

```sh
npm run lint
npm run typecheck
npm run build
```

Then go back to `chrome://extensions` and click the reload button on unframed.

## What To Check

- News article analysis shows summary, main issue, three bias detection meters, framing prompts, potentially loaded language, attributed sources, included perspectives, perspectives to check, evidence, and confidence.
- Bill analysis shows summary, main issue, three bias detection meters, proposed changes, potentially affected groups, directly attributed supporters/opponents, unclear impacts, sourced terms, evidence, and confidence.
- Unsupported pages show an error and point users to Manual Paste.
- **Save locally** stores an analysis.
- **History** opens and deletes saved analyses.
- **Feedback** records anonymous feedback only on the current device; it is not submitted to the team in this MVP.
- **New analysis** resets the panel for another test.

## Current Limits

This is an MVP prototype. Analysis is local and heuristic, and its confidence is intentionally capped below “High.” It does not yet use an LLM API, Supabase, the Congress.gov API, outlet-context databases, or external citation validation. Source-text evidence, outside context, and parser notes are labeled separately.

The extension has access to ordinary HTTP and HTTPS pages so Analyze continues to work after navigation, but the content script is injected only when the user requests an analysis. Saved analyses and feedback stay in local extension storage. Full extracted or pasted page text is not stored unless it appears as a short evidence excerpt inside an explicitly saved analysis.

The optional Source URL in Manual Paste is citation metadata only; it does not fetch article text. Paste the source text into the text field before selecting **Analyze pasted text**.

The optional backend adds RoBERTa political-bias classification, counterfactual sentiment scoring, toxicity/coded-hostility filtering, dependency/coreference signals, and an optional LLM contextual audit.
