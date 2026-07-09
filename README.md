# unframed

unframed is a Chrome side-panel extension prototype. It helps readers review news articles and Congress.gov bills for framing, evidence, missing perspectives, and uncertainty.

## Test In Chrome

1. Build the extension:

```sh
npm install
npm test
npm run build
```

2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select:

```text
/Users/jiachen/Documents/Repos/Unframed/dist
```

6. Open a specific news article or Congress.gov bill page.
7. Click the unframed extension icon.
8. Click **Analyze** in the side panel.

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

- News article analysis shows summary, main issue, framing prompts, potentially loaded language, attributed sources, included perspectives, perspectives to check, evidence, and confidence.
- Bill analysis shows summary, main issue, proposed changes, potentially affected groups, directly attributed supporters/opponents, unclear impacts, sourced terms, evidence, and confidence.
- Unsupported pages show an error and point users to Manual Paste.
- **Save locally** stores an analysis.
- **History** opens and deletes saved analyses.
- **Feedback** records anonymous feedback only on the current device; it is not submitted to the team in this MVP.
- **New analysis** resets the panel for another test.

## Current Limits

This is an MVP prototype. Analysis is local and heuristic, and its confidence is intentionally capped below “High.” It does not yet use an LLM API, Supabase, the Congress.gov API, outlet-context databases, or external citation validation. Source-text evidence, outside context, and parser notes are labeled separately.

The extension has access to ordinary HTTP and HTTPS pages so Analyze continues to work after navigation, but the content script is injected only when the user requests an analysis. Saved analyses and feedback stay in local extension storage. Full extracted or pasted page text is not stored unless it appears as a short evidence excerpt inside an explicitly saved analysis.

The optional Source URL in Manual Paste is citation metadata only; it does not fetch article text. Paste the source text into the text field before selecting **Analyze pasted text**.
