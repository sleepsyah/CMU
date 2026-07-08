# Unframed

Unframed is an Astro-built Chrome Manifest V3 side-panel extension prototype for evidence-based article and Congress.gov bill analysis.

## Run Locally

```sh
npm install
npm run build
```

Then load `dist/` as an unpacked Chrome extension.

## MVP Behavior

- Opens as a Chrome side panel.
- Extracts active page title, URL, source, links, and readable text.
- Classifies content as article, Congress.gov bill, or unknown.
- Produces local evidence-backed analysis with confidence labels.
- Provides a manual paste fallback when extraction fails.
- Saves up to 50 analyses in local extension storage.
- Logs anonymous feedback locally.

The analyzer is local and heuristic for the prototype. It does not make unsupported demographic or political claims and keeps LLM/backend integration as a later extension point.
