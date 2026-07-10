# Methodology and validation plan

## Product boundary

Ellipsis is a 20-second critical-reading aid for college-level readers. It separates three requested dimensions:

- **Political wording and framing:** loaded language, epistemic reporting verbs, and selected persuasion patterns.
- **Gender framing:** direct associations between gender references and stereotyped descriptions.
- **Ethnicity framing:** direct associations between racial, ethnic, religious, or immigration references and hostile or negative descriptions.

The scales estimate detected cue strength. They do not measure factuality, intent, outlet ideology, or complete representational fairness. No-evidence results are reported as **Not assessed**, not neutral.

## Research translated into the MVP

- [BABE](https://aclanthology.org/2021.findings-emnlp.101/) supports expert-annotated word- and sentence-level lexical bias detection. This is why the optional model is run on sentences and why the interface shows exact passages.
- [Linguistic Models for Analyzing and Detecting Biased Language](https://aclanthology.org/P13-1162/) distinguishes framing and epistemological cues. This motivates checking loaded wording and reporting verbs separately.
- [Fine-Grained Analysis of Propaganda in News Articles](https://aclanthology.org/D19-1565/) evaluates propaganda at the text-span level. This supports evidence-linked cue explanations rather than a document-only verdict.
- [BASIL](https://aclanthology.org/D19-1664/) shows that informational bias can occur in factual text through selection and emphasis. Because a single source cannot prove omission, Ellipsis presents genre-aware questions rather than omission claims.
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

Cross-document comparison, publisher history, outlet reputation, image framing, agenda setting over time, and external evidence retrieval could improve analysis. They remain deferred because they require broader data collection, new privacy choices, and a larger interface than the current lightweight extension.
