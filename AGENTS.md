# AGENTS.md

## Project

Ellipsis is a lightweight Chrome Manifest V3 side-panel extension built with Astro, React, and TypeScript.

## Branding

- The product, Chrome extension, side panel, documentation, and native AI connector are branded **Ellipsis**.
- Use **Ellipsis** in every user-facing name, label, message, manifest field, installer, package, and artifact.
- Do not introduce alternate product or extension branding.
- New internal identifiers should use `ellipsis`.

## Source of Truth

The linked PRD and Spec Google Doc tabs are the source of truth for product behavior. Do not add political recommendations, true/false ratings, user profiling, demographic support guesses, state bill support, classroom mode, or side-by-side coverage comparison unless the product requirements change.

## Build Commands

- `npm install`
- `npm run typecheck`
- `npm run build`

## Implementation Notes

- Keep the extension no-login by default.
- Store saved analyses locally and cap history at 50 items.
- Keep feedback anonymous.
- Do not store unrelated browsing history.
- Separate source text evidence from any outside context.
- Mark uncertainty clearly and avoid unsupported claims.
- The current MVP uses local heuristic analysis. Future LLM or Supabase work should preserve the same structured analysis shape and guardrails.
