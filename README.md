# Ellipsis

Ellipsis is a lightweight Chrome side-panel extension for reviewing news articles and Congress.gov bills. It gives readers a short summary, three evidence-conditioned bias scales, and at most three things to inspect more closely.

The extension does not rate factuality or tell readers what to believe. A low score means few supported local cues were detected. It does not prove neutrality. A dimension remains **Not assessed** when the source does not contain enough direct evidence.

## Run and test

```sh
npm install
npm test
npm run typecheck
npm run build
```

Load the generated `dist/` folder from `chrome://extensions` with Developer mode enabled.
After rebuilding an already loaded copy, click **Reload** on its extension card so Chrome refreshes the manifest name and browser-level icons.

The optional local model helper is documented in [`backend/README.md`](backend/README.md). The extension accepts only an explicit loopback HTTP endpoint, so article text cannot be configured to go to a remote backend.

## Main flow

1. Open a specific news article or Congress.gov bill and select **Analyze page**.
2. Alternatively, paste a public link or source text.
3. Review the summary, political/gender/ethnicity signal scales, and up to three evidence-linked checks.
4. Open **Details** for the complete evidence and parser notes.
5. Save useful results locally. History is capped at 50 items.

Link fetching is performed directly from the extension with credentials omitted. Full source text is analyzed in memory and is not saved. Explicitly saved results contain only short evidence excerpts.

## Supported sources

- Specific English-language article pages with semantic article, main-content, or standard metadata markup.
- Static public article URLs that expose readable HTML without login or paywall access.
- Congress.gov bill pages and pasted federal bill text.

Home pages, search pages, protected browser pages, PDFs, login-only sources, client-rendered pages with no readable HTML, and state legislation are outside the current support boundary.

## Method limits

- Scores represent the strength of detected wording or direct framing cues, not political ideology, factuality, intent, or outlet quality.
- Political cues include loaded language, epistemic reporting verbs, and a small set of persuasion patterns.
- Gender and ethnicity are assessed only when a group reference is directly paired with a stereotyped or hostile description in the same non-negated sentence.
- Questions about omitted context depend on source genre. They are questions, not confirmed omissions.
- Cross-document comparison, image analysis, outlet profiling, and external fact retrieval are research directions, not hidden features in this MVP.

See [`docs/methodology.md`](docs/methodology.md) for the research basis and validation plan.
