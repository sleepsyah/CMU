# Methodology and validation plan

## Product boundary

Ellipsis is a lightweight critical-reading aid for college-level readers. It separates three requested dimensions:

- **Political wording and framing:** loaded language, epistemic reporting verbs, and selected persuasion patterns.
- **Gender framing:** direct associations between gender references and stereotyped descriptions.
- **Ethnicity framing:** direct associations between racial, ethnic, religious, or immigration references and hostile or negative descriptions.

The scales estimate detected cue strength. They do not measure factuality, intent, outlet ideology, or complete representational fairness. No-evidence results are reported as **No direct evidence found** with no score or bar. The overall profile summarizes article-level bias cues with a narrative and score; it is not a rating of the publisher or site.

When enabled, Codex produces the complete analysis rather than adding findings to the heuristic result. It creates the summary, frames, span-level cues, source participation, review questions, confidence, and researched claim checks. Local heuristics are a fallback only. Claim-level checks can be supported, contradicted, unresolved, or marked as needing context, with citations. Ellipsis does not collapse those checks into a single truth, political-alignment, or outlet-quality rating. Outside research is kept separate from source-text evidence.

## Research translated into the MVP

- [BABE](https://aclanthology.org/2021.findings-emnlp.101/) supports expert-annotated word- and sentence-level lexical bias detection. This is why the optional model is run on sentences and why the interface shows exact passages.
- [Linguistic Models for Analyzing and Detecting Biased Language](https://aclanthology.org/P13-1162/) distinguishes framing and epistemological cues. This motivates checking loaded wording and reporting verbs separately.
- [Fine-Grained Analysis of Propaganda in News Articles](https://aclanthology.org/D19-1565/) evaluates propaganda at the text-span level. This supports evidence-linked cue explanations rather than a document-only verdict.
- [BASIL](https://aclanthology.org/D19-1664/) shows that informational bias can occur in factual text through selection and emphasis. Because a single source cannot prove omission, Ellipsis presents genre-aware questions rather than omission claims.
- [The Media Frames Corpus](https://aclanthology.org/P15-2072/) motivates the multi-label framing profile. Ellipsis displays prominent frames such as economic, fairness, legality, health, quality of life, and political emphasis without collapsing them into a left-right label.
- [Longitudinal racial and gender representation research](https://arxiv.org/abs/2410.21898) measures representation across large article collections. This is why the MVP does not infer demographic underrepresentation from a single article.

## Local scoring rules

1. Split the source into sentences.
2. Identify exact cue spans and retain the source sentence.
3. Require a direct same-sentence association for gender and ethnicity cues.
4. Ignore negated association patterns such as “does not claim” or “no evidence.”
5. Produce a score only when at least one evidence item meets the dimension's rule.
6. Cap local heuristic confidence below high confidence.
7. Show no more than one primary finding per bias dimension before using genre-aware reading questions to fill the three-item result.

These weights are an interpretable prototype, not a statistically calibrated probability.

## Sources and Voices

Ellipsis extracts a small set of explicit sources from the complete readable document before optional AI enhancement. Live blogs are divided into semantic page blocks and bounded sentence chunks, every retained block is processed, and the result records processed characters, total characters, block counts, skipped page-furniture blocks, and truncation status.

The source pipeline records attribution events rather than treating capitalized entities as speakers. Each event keeps the attributed actor, claim, optional quoted fragment, attribution type, exact evidence sentence, sentence index, block identifier, any reporting intermediary, and whether the actor was only mentioned. Source identity fields and evidence fields remain separate: a full sentence is never a card display name or an alias. Cards are limited to people, organizations, government bodies, documents, and clearly identified unnamed groups with direct attribution evidence. Mentioned-only entities are not displayed.

Before display, source names are repaired or rejected when they include reporting verbs, finite claims, sentence or quotation syntax, excessive evidence overlap, or unsafe length. Quotation marks alone do not make an attribution direct: the quoted words must be the primary content immediately attributed to the source. Quoted fragments inside a paraphrase remain evidence metadata and the card stays paraphrased. Development builds log the extracted source span, evidence span, canonicalization result, attribution class, and rejection or repair reason.

Aliases are resolved after all blocks are processed. Resolution normalizes punctuation, possessives, honorifics, whitespace, and case; merges an unambiguous surname with its fullest article-supported name; and connects supplied acronyms or derivable organization abbreviations. Agencies remain separate from their countries. Nested chains retain the primary claim holder and record outlets such as Reuters or IRIB as reporting channels, not separate voices unless the article independently attributes a claim to them.

Each source card contains a short neutral description of what the article attributes to the source, the exact evidence passage, and a link back to that passage. Sources are ranked by the substance and clarity of their attribution, combined across repeated mentions, and capped at eight. This deterministic parser is deliberately conservative: ambiguous surname matches, pronouns without a unique named antecedent, and unclear grammatical subjects are omitted rather than guessed. It does not assign ideology, sentiment, agreement, balance, or fairness labels. Optional AI output cannot replace these source cards.

## Outlet profile and placement chart

For articles, Ellipsis profiles the publishing outlet itself alongside the article analysis. The profile reports where the outlet is headquartered, its country, ownership, funding model, founding year, and medium, and plots the outlet on a two-axis chart among a fixed set of reference outlets.

### Where the two axes come from

Neither axis is Ellipsis's own judgement. Both are joined from published, openly available research datasets, and an outlet absent from them is shown without a placement rather than with an estimated one.

**Vertical axis — rated journalistic quality (0-100).** The `pc1` score from Lin et al. (2023), the first principal component across six independent expert rating sets (including Ad Fontes Media, Media Bias/Fact Check, and NewsGuard-derived ratings), covering 11,520 domains. The paper's finding is that these rating sets correlate highly with one another, so the component is a more stable signal than any single rater.

> Lin, H., Lasser, J., Lewandowsky, S., Cole, R., Gully, A., Rand, D. G., & Pennycook, G. (2023). High level of correspondence across different news domain quality rating sets. *PNAS Nexus*, 2(9), pgad286. <https://doi.org/10.1093/pnasnexus/pgad286>

**Horizontal axis — US audience partisanship (-100 to +100).** The `leaning_score` from the DomainDemo derived metrics (Yang et al., 2025), computed from a panel of over 1.5 million Twitter/X users matched to US voter-registration records, covering 129,127 domains. Negative means the domain was shared mainly by registered Democrats, positive by registered Republicans.

> Yang, K.-C., Goel, P., Quintana-Mathé, A., Horgan, L., McCabe, S. D., Grinberg, N., Joseph, K., & Lazer, D. (2025). DomainDemo: a dataset of domain-sharing activities among different demographic groups on Twitter. *Scientific Data*, 12(1), 1251. <https://doi.org/10.1038/s41597-025-05604-6>

### Reading the horizontal axis correctly

The partisanship axis measures **who shares an outlet, not what the outlet argues**. Two consequences are visible on the chart and are stated in the interface rather than corrected away:

- **The distribution sits left of zero.** Wire services land near -22, close to the New York Times, because US Democrats share them more often — not because they report from the left. Ellipsis therefore labels this axis by sharing behaviour ("shared more by Democrats") and never as "left", "right", or "centrist".
- **Non-US outlets reflect their American audience.** Because the panel is a US voter file, British right-leaning papers score near zero or negative: they are read in the US by a different population than at home. Profiles for outlets based outside the United States carry an explicit caveat saying so.

Placements describe the outlet, never the analyzed article, and are not a verdict on whether either is true or trustworthy. Outlet-specific caveats (state funding, ownership concentration) are carried in the placement note.

Each outlet is drawn as its own site icon. Some reference outlets land within a few pixels of each other — the two wire services differ by about 3px, NPR and The Economist by about 1px — which is illegible at icon size, so overlapping markers are nudged apart by up to roughly 10px. The analyzed outlet is always held at its true position, and the tooltip and the "view placements as a table" disclosure report exact values for every outlet.

### How a profile resolves

First, the normalized outlet host is matched against the bundled dataset; this works offline and without AI. Second, a previously AI-researched profile is restored from local extension storage when available. Third, when AI deep analysis is enabled and the outlet is still unknown, the provider researches it with at most two focused searches.

AI research returns **descriptive facts and citations only** — headquarters, ownership, funding, founding year, medium. It is explicitly instructed not to rate quality, accuracy, bias, or leaning, because such an estimate would appear on the same axes as measured values and be indistinguishable from them. A researched profile without valid citations is discarded rather than displayed. Researched profiles are cached locally so repeat visits do not repeat the research.

### Regenerating the data

`npm run data:outlets` re-downloads both datasets, re-joins them against the curated outlet metadata in `data/outlets.json`, refetches reference-outlet icons, and rewrites `src/lib/outlet-data.generated.ts`. The generated file is committed so the extension builds without network access. Editorial metadata is hand-maintained; scores are never hand-edited.

## Optional Codex analysis

1. Send the extracted source, title, source name, and content type through Chrome Native Messaging when the user has enabled AI.
2. Ask Codex for the complete structured analysis. Do not merge heuristic findings into a successful AI result.
3. Let Chrome launch the registered Ellipsis connector on demand. The connector uses Codex app-server for account state and browser-based sign-in, with no localhost HTTP listener.
4. Run GPT-5.5 with low reasoning in a read-only temporary workspace. Built-in web search is the only allowed tool. Computer Use, browser control, plugins, MCP servers, shell commands, and file access are disabled before the Codex runtime starts.
5. Start with one focused search for material claims and use one or two follow-ups when consequential details remain unclear, while allowing additional research when accuracy requires it. Prefer primary sources, official records, original research, and high-quality reporting.
6. Require structured output for summary evidence, an article-level bias profile, internal evidence confidence, Media Frames Corpus labels, span-level cues, review questions, and claim-level research checks.
7. Reject summary evidence, frame evidence, and bias cues whose quoted text cannot be matched to the supplied source.
8. Require each claim check to match an exact passage from the supplied source and include at least one valid web citation.
9. Keep Sources and Voices in the local explicit-attribution pipeline; do not ask the AI provider to infer sources, positions, missing viewpoints, balance, or fairness.
10. Stop the AI run if Codex attempts a blocked tool category.
11. Run the complete local analysis only when AI is disabled or connector startup, authentication, the SDK run, schema validation, evidence matching, or restriction verification fails.

AI confidence measures extraction coverage and evidence support. It is capped and is not a probability that the analysis or source is true.

## Genre-aware review questions

- Opinion: evidence for the central claim and the strongest reasonable counterargument.
- Data or research report: methods, sample, limitations, and independent interpretation.
- Event report: directly affected people and corroborating sources or records.
- Investigation: primary records and a meaningful response from subjects.
- Explainer or general article: affected people, primary documents, and independent expertise.
- Bill: proposed changes, directly affected groups, funding, implementation, timing, and sourced support or opposition when present.

## Validation before public release

The public-use target requires a frozen evaluation set and documented thresholds:

1. Evaluate political wording cues on held-out BABE, MBIC, and BASIL-style span annotations without training on the test publishers.
2. Build a separate expert-labeled English news set for gender and ethnicity associations. Generic model-bias benchmarks are not substitutes for article-level ground truth.
3. Include neutral hard negatives containing crime, immigration, gender, and identity vocabulary without stereotyped framing.
4. Report precision, recall, F1, calibration error, false positives by genre, and disagreement among annotators.
5. Run user studies for comprehension, time-to-insight, trust calibration, and whether evidence changes how readers inspect a source.
6. Do not label thresholds low, moderate, or high as validated until the evaluation results support them.

## Deferred research directions

Cross-document comparison, publisher history, outlet reputation, image framing, and agenda setting over time could improve analysis. They remain deferred because they require broader data collection, new privacy choices, and a larger interface than the current lightweight extension.
