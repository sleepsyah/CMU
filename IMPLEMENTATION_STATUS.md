# Implementation Status

## Current Summary

Unframed is a working local MVP Chrome side-panel extension. It can analyze extracted or pasted article/bill text, show evidence and confidence, save local history, and record anonymous local feedback.

The MVP is not production-complete. It does not yet have LLM-backed analysis, Supabase persistence, Congress.gov API integration, or external source validation.

## PRD / Spec Status

| Requirement | Status | Notes |
| --- | --- | --- |
| Chrome Manifest V3 extension | Done | Built in `dist/` with `manifest.json`, background script, content script, and side-panel page. |
| Chrome side-panel UI | Done | Opens as `sidepanel/index.html`; UI is compact for side-panel width. |
| No login required | Done | No account or auth flow exists. |
| Analyze current page | Done for MVP | Content script extracts readable text from supported pages. Likely home/index pages are rejected instead of analyzed. |
| Manual paste fallback | Done | Users can paste article or bill text when extraction fails. |
| Article analysis | Done locally | Shows summary, main issue, framing, loaded language, quoted sources, included perspectives, missing perspectives, evidence, and confidence. |
| Congress.gov bill analysis | Done locally | Shows plain-language summary, proposed changes, affected groups, sourced supporters/opponents, unclear impacts, important terms, evidence, and confidence. |
| Evidence for major claims | Partial | Evidence is tied to extracted/pasted text. External source validation is not implemented. |
| Confidence labels | Done | Analysis and evidence include confidence scores/labels. |
| Low-confidence warning | Done | Low-confidence results show a warning. |
| Unsupported claims removed or uncertain | Partial | Heuristics avoid unsupported supporter/opponent claims and show uncertainty, but no LLM validation exists. |
| Save history locally | Done | Saves up to 50 analyses in local extension storage. |
| Delete saved analyses | Done | History items can be deleted. |
| Anonymous feedback | Done locally | Helpful, Confusing, Incorrect, Biased, plus optional comment are stored locally. |
| Supabase feedback/log storage | Not done | Waiting on project credentials and backend setup. |
| LLM structured JSON analysis | Not done | Current analyzer is heuristic/local. |
| Congress.gov API | Not done | Current bill support uses extracted or pasted page text. |
| Outlet/context databases | Not done | No external outlet-bias/context database is connected. |
| External civic/fact-check sources | Not done | No external citation lookup or validation is connected. |

## Completed Work

- Initialized git.
- Read the linked PRD and Spec tabs.
- Built the Astro + React extension shell.
- Implemented active-page extraction.
- Implemented article/bill classification.
- Added unsupported-page handling for noisy home/index pages.
- Implemented article and bill result views.
- Implemented evidence, confidence, warnings, loading, errors, empty states, manual paste, save, history, delete, feedback, and reset flow.
- Fixed Chrome extension packaging issues:
  - no reserved `_astro` folder
  - no inline side-panel script/style
- Tightened classification so fragments like `S.7` do not turn normal news pages into bills.
- Filtered generic labels like “supporters” and “critics” out of sourced supporter/opponent claims unless a named source is present.

## Verification

Passed:

```sh
npm run lint
npm run typecheck
npm run build
npm audit --omit=dev
```

Manual checks completed:

- Side-panel UI at 360px width.
- Manual news article analysis.
- Manual Congress.gov-style bill analysis.
- New analysis reset flow.
- Built `dist/` contains no `_`-prefixed files/folders.
- Built side-panel HTML has no inline `<script>` or `<style>`.

## Next Steps

1. Add a real LLM analysis endpoint with structured JSON output.
2. Add Supabase tables for feedback and analysis logs.
3. Add Congress.gov API support for bill metadata/text.
4. Add external citation/context source validation.
5. Add fixture tests for article extraction, bill classification, and analyzer output.
