# Ellipsis implementation status

## Current product

Ellipsis is a working local-first Chrome side-panel MVP for a roughly 20-second review of English news articles and Congress.gov bills.

The primary result contains:

- one short source summary;
- separate political, gender, and ethnicity cue scales;
- at most three evidence-linked observations or review questions;
- save and source actions.

Full evidence, parser notes, method confidence, and feedback are kept in the secondary Details tab. Saved history remains a primary tab and is capped at 50 local items.

## Implemented

- Chrome Manifest V3 side panel with active-page extraction.
- Direct public-link fetching with omitted credentials and no referrer.
- Compact manual-paste fallback with optional source metadata.
- Article and federal bill classification.
- Genre-aware article review questions.
- Evidence-conditioned political, gender, and ethnicity scales.
- Direct same-sentence and non-negation requirements for demographic cues.
- “Not assessed” states instead of synthetic baseline scores.
- Short source-text evidence and explicit analysis-note separation.
- Local save, open, delete, clear, and 50-item history cap.
- Local feedback retained inside Details rather than as a top-level feature.
- Optional loopback-only FastAPI model helper.
- Sentence-level BABE classifier use and event-loop-safe local model execution.
- No remote LLM analysis path.

## Privacy boundary

- No login or user profile.
- Active-page extraction runs only after Analyze.
- Link fetching contacts only the supplied page and omits browser credentials.
- Full article or bill text is not stored in history.
- The frontend rejects remote model-helper URLs.
- Feedback remains local and is explicitly not presented as submitted to the team.
- No unrelated browsing history is collected.

## Current limits

- Scale weights are interpretable prototype weights, not calibrated probabilities.
- Gender and ethnicity scales detect direct textual associations; they do not measure corpus-level representation from one article.
- No cross-document comparison, image analysis, outlet profiling, Congress.gov API, or external factual validation.
- Link extraction cannot bypass paywalls, login, bot protection, or client-only rendering.
- State legislation is outside the current source boundary.
- Backend dependencies and model downloads remain an optional separate setup.
- A team feedback endpoint is not configured.

## Verification

Automated checks:

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev
python3 -m compileall -q backend/app
```

Manual regression coverage:

- 320 px and 360 px width without horizontal overflow.
- Neutral crime-report hard negative produces no ethnicity score.
- Direct political, gender, and ethnicity cue evidence.
- Genre-aware article questions.
- Compact federal bill result.
- Active-page, link, and paste entry paths.
- Details separation, saved history, and local feedback controls.

## Before public release

1. Complete the validation plan in `docs/methodology.md` and publish per-genre error rates.
2. Add saved-page extraction fixtures and extension-level Chrome tests for supported sites.
3. Test fresh-install permissions and side-panel behavior across navigation.
4. Decide whether feedback is in scope; if it is, add an explicit opt-in endpoint that never receives article text.
5. Add official Congress.gov structured data without expanding the primary result.
