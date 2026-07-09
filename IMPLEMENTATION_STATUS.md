# unframed implementation status

## Current Summary

unframed is a working local MVP Chrome side-panel extension. It can analyze extracted or pasted article/bill text, connect displayed findings to labeled evidence, show calibrated uncertainty, save local history, and record anonymous local feedback.

The MVP is not production-complete. It does not yet have LLM-backed analysis, Supabase persistence, Congress.gov API integration, or external source validation.

## PRD / Spec Status

| Requirement | Status | Notes |
| --- | --- | --- |
| Chrome Manifest V3 extension | Done | Built in `dist/` with `manifest.json`, background script, content script, and side-panel page. |
| Chrome side-panel UI | Done | Opens as `sidepanel/index.html`; UI is compact for side-panel width. |
| No login required | Done | No account or auth flow exists. |
| Analyze current page | Done for local MVP | The content script is injected on demand into the active page; broad all-site host permission is not requested. |
| Manual paste fallback | Done | Users can paste article or bill text when extraction fails. |
| Article analysis | Done locally | Shows summary, main issue, framing prompts, potentially loaded language, attributed sources, included perspectives, perspectives to check, evidence, and confidence. |
| Congress.gov bill analysis | Done locally | Shows summary, main issue, proposed changes, potentially affected groups, directly attributed supporters/opponents, unclear impacts, sourced terms, evidence, and confidence. |
| Evidence for displayed findings | Done locally | Findings carry evidence IDs. Evidence is labeled as source text, outside context, or analysis note. Independent external validation is not implemented. |
| Confidence labels | Done locally | Overall, finding, and evidence confidence are shown. Local heuristic overall confidence is capped below High. |
| Low-confidence warning | Done | Overall warnings and claim-level low-confidence styling are present. |
| Unsupported claims removed or uncertain | Improved locally | Negation and attribution regressions are tested; missing perspectives are phrased as questions, not confirmed omissions. LLM/external validation is still absent. |
| Save history locally | Done | Saves up to 50 analyses in local extension storage. |
| Delete saved analyses | Done | History items can be deleted. |
| Anonymous feedback | Done locally | Helpful, Confusing, Incorrect, Biased, plus optional comment are stored locally and explicitly described as not submitted to the team. |
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
- Linked displayed findings to labeled evidence and separated source text, outside context, and parser notes.
- Added the required bill main-issue section and claim-level confidence presentation.
- Added optional title, source, and URL fields for manual paste.
- Added storage success/error states, clear-history controls, and a privacy summary.
- Replaced broad all-site host permission with active-page, on-demand script injection.
- Added regression tests for attribution, negation, affected-group detection, evidence links, and classification.
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
npm test
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

1. Add a guarded LLM analysis endpoint with schema validation and the same evidence-linked shape.
2. Add an opt-in, privacy-preserving feedback and metrics endpoint if the product team confirms the telemetry scope.
3. Add Congress.gov API support for complete bill metadata and text.
4. Add cited outlet/civic context with explicit source-versus-outside-context separation.
5. Expand extraction fixtures with real saved pages and add extension-level Chrome tests.
