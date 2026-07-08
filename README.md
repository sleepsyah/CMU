# Unframed

Unframed is a Chrome side-panel extension prototype. It helps readers review news articles and Congress.gov bills for framing, evidence, missing perspectives, and uncertainty.

## Test In Chrome

1. Build the extension:

```sh
npm install
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
7. Click the Unframed extension icon.
8. Click **Analyze** in the side panel.

If the page cannot be extracted, paste article or bill text into **Manual Paste** and click **Analyze pasted text**.

## Test After Code Changes (NON-AGENTS can ignore)

Run:

```sh
npm run lint
npm run typecheck
npm run build
```

Then go back to `chrome://extensions` and click the reload button on Unframed.

## What To Check

- News article analysis shows summary, main issue, framing, loaded language, quoted sources, included perspectives, missing perspectives, evidence, and confidence.
- Bill analysis shows plain-language summary, proposed changes, affected groups, sourced supporters/opponents only when supported, unclear impacts, important terms, evidence, and confidence.
- Unsupported pages show an error and point users to Manual Paste.
- **Save locally** stores an analysis.
- **History** opens and deletes saved analyses.
- **Feedback** logs anonymous local feedback.
- **New analysis** resets the panel for another test.

## Current Limits

This is an MVP prototype. Analysis is local and heuristic. It does not yet use an LLM API, Supabase, Congress.gov API, outlet-context databases, or external citation validation. Fully Vibe coded.
