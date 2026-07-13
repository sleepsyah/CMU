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

## Optional Codex analysis

1. Send the extracted source, title, source name, and content type through Chrome Native Messaging when the user has enabled AI.
2. Ask Codex for the complete structured analysis. Do not merge heuristic findings into a successful AI result.
3. Let Chrome launch the registered Ellipsis connector on demand. The connector uses Codex app-server for account state and browser-based sign-in, with no localhost HTTP listener.
4. Run GPT-5.5 with low reasoning in a read-only temporary workspace. Built-in web search is the only allowed tool. Computer Use, browser control, plugins, MCP servers, shell commands, and file access are disabled before the Codex runtime starts.
5. Start with one focused search for material claims and use one or two follow-ups when consequential details remain unclear, while allowing additional research when accuracy requires it. Prefer primary sources, official records, original research, and high-quality reporting.
6. Require structured output for summary evidence, an article-level bias profile, internal evidence confidence, Media Frames Corpus labels, span-level cues, review questions, and claim-level research checks.
7. Reject summary evidence, frame evidence, and bias cues whose quoted text cannot be matched to the supplied source.
8. Require each claim check to match an exact passage from the supplied source and include at least one valid web citation.
9. Stop the AI run if Codex attempts a blocked tool category.
10. Keep omission and missing-perspective output phrased as questions.
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
