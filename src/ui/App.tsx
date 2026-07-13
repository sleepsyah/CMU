import {
  BookOpenText,
  ClockCounterClockwise,
  FileText,
  FloppyDisk,
  Info,
  LinkSimple,
  MagnifyingGlass,
  Trash,
  WarningCircle
} from "@phosphor-icons/react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { classifyPastedText, confidenceLabel, keyFindingsFor } from "../lib/analysis";
import { analyzePageWithBackend, getBackendStatus, type BackendStatus } from "../lib/backend";
import { createManualPage, extractActivePage, highlightActivePagePassage } from "../lib/chrome";
import {
  clearFeedbackLogs,
  clearSavedAnalyses,
  deleteSavedAnalysis,
  getSavedAnalyses,
  logFeedback,
  saveAnalysis
} from "../lib/storage";
import { fetchPageFromUrl, normalizeWebUrl } from "../lib/url";
import type {
  Analysis,
  AnalysisFinding,
  ArticleGenre,
  BackendBiasAnalysis,
  BiasSignal,
  BiasDimension,
  BiasMetric,
  BillAnalysis,
  ContentType,
  FeedbackType,
  SavedAnalysis
} from "../types";

type Tab = "analysis" | "vocabulary" | "saved" | "details";
type VocabularyTerm = { term: string; definition: string; context?: string; source: string };

const feedbackTypes: FeedbackType[] = ["Helpful", "Confusing", "Incorrect", "Biased"];
const glossaryDefinitions: Record<string, string> = {
  amendment: "A change added to a bill, law, or official document.",
  appropriation: "Money that a bill or law sets aside for a specific use.",
  appropriations: "Government money set aside for specific programs or agencies.",
  authorize: "To officially allow something to happen.",
  authorization: "Legal permission for a program or activity to exist, sometimes separate from the money that pays for it.",
  bipartisan: "Supported by people from both major political parties.",
  coalition: "A group of people or organizations working together.",
  committee: "A smaller group that studies a bill or issue before the full group votes.",
  compliance: "Following a rule, law, or requirement.",
  constituents: "People represented by an elected official.",
  deficit: "When spending is higher than income or revenue.",
  discretionary: "Something that is optional or decided by officials, not automatically required.",
  enforcement: "The process of making sure a rule or law is followed.",
  fiscal: "Related to money, budgets, or government spending.",
  grant: "Money given for a specific purpose, often by the government.",
  implementation: "How a plan, policy, or law would actually be put into action.",
  jurisdiction: "The area or topic that a government body, court, or agency has power over.",
  liability: "Legal responsibility for harm, damage, or debt.",
  mandate: "A rule or order that requires someone to do something.",
  oversight: "Watching or reviewing how a program, agency, or rule is working.",
  provision: "A specific part of a bill, contract, or law.",
  regulation: "A rule made by a government agency.",
  regulatory: "Related to rules made by a government agency.",
  sanctions: "Penalties used to pressure a person, group, or country to change behavior.",
  statute: "A written law passed by a legislature.",
  subsidy: "Money or support from the government that helps lower costs for a person, business, or activity.",
  subpoena: "A legal order requiring someone to provide information or appear to testify.",
  tariff: "A tax on goods imported from another country.",
  testimony: "A formal statement, often given in court or to lawmakers.",
  waiver: "Permission to skip or not follow a usual rule."
};
const difficultTermSources = new Set(["Bill term", "Plain-English glossary", "Abbreviation"]);
const policyPhrasePattern = /\b(?:rent freeze|government overreach|housing shortage|new construction|property owners|reporting requirement|effective date|tax credit|grant program|public benefit|civil penalty|housing crisis)\b/i;
const policyPhraseGlobalPattern = /\b(?:rent freeze|government overreach|housing shortage|new construction|property owners|reporting requirement|effective date|tax credit|grant program|public benefit|civil penalty|housing crisis)\b/gi;

function contentLabel(type: ContentType) {
  if (type === "bill") return "Congress.gov bill";
  if (type === "article") return "News article";
  if (type === "unsupported") return "Unsupported";
  return "Unknown";
}

function genreLabel(genre: ArticleGenre) {
  if (genre === "data_report") return "Data or research report";
  return `${genre[0].toUpperCase()}${genre.slice(1)}`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function toSavedAnalysis(analysis: Analysis): SavedAnalysis {
  return {
    id: analysis.id,
    url: analysis.url,
    pageTitle: analysis.pageTitle,
    contentType: analysis.contentType,
    createdAt: analysis.createdAt,
    summary: analysis.summary,
    confidenceScore: analysis.confidenceScore,
    analysis
  };
}

function firstEvidence(analysis: Analysis, finding: AnalysisFinding) {
  return finding.evidenceIds
    .map((id) => analysis.evidence.find((item) => item.id === id))
    .find((item) => item?.kind === "source_text");
}

function primaryFindingsFor(analysis: Analysis) {
  const findings: Array<{ text: string; context?: string; signalId?: string }> = [];
  const seenDimensions = new Set<BiasDimension>();
  for (const signal of analysis.backendBias?.linguistic_evidence.signals || []) {
    if (seenDimensions.has(signal.dimension)) continue;
    seenDimensions.add(signal.dimension);
    findings.push({
      text: signal.dimension === "political"
        ? `Political wording cue: “${signal.phrase}” may add emotional or evaluative force.`
        : `${dimensionTitle(signal.dimension)} cue: “${signal.phrase}” is directly associated with a group reference.`,
      context: signal.context,
      signalId: signal.id
    });
  }

  for (const finding of keyFindingsFor(analysis)) {
    const evidence = firstEvidence(analysis, finding);
    const context = evidence?.supportingText;
    if (findings.some((item) => item.text === finding.text || (context && item.context === context))) continue;
    findings.push({ text: finding.text, context });
    if (findings.length >= 3) break;
  }
  return findings.slice(0, 3);
}

function signalElementId(signalId: string) {
  return `signal-${signalId}`;
}

function LoadingState() {
  return (
    <section className="surface loading-state" aria-live="polite">
      <div className="skeleton wide" />
      <div className="skeleton medium" />
      <div className="skeleton short" />
      <p className="helper">Reading the source and linking signals to evidence.</p>
    </section>
  );
}

function BackendStatusPill({ status, fallback }: { status: BackendStatus | null; fallback: boolean }) {
  const state = fallback ? "fallback" : status?.state || "offline";
  const label = fallback ? "Heuristic fallback" : status?.label || "Backend unknown";
  return <span className={`backend-status is-${state}`}>{label}</span>;
}

function MetricRow({ title, metric, modelLabel, signals = [], onSignalSelect }: { title: string; metric: BiasMetric; modelLabel: string; signals?: BiasSignal[]; onSignalSelect?: (signalId: string) => void }) {
  const assessed = metric.status === "assessed" && metric.score !== null;
  const score = assessed ? Math.round(metric.score as number) : null;
  const strength = score === null ? "No direct cues found" : score < 34 ? "Low detected signal" : score < 67 ? "Moderate detected signal" : "High detected signal";
  const evidenceLabel = metric.evidenceCount === 1 ? "1 cited passage" : `${metric.evidenceCount} cited passages`;
  const tone = score === null ? "neutral" : score < 34 ? "low" : score < 67 ? "moderate" : "high";
  const meterWidth = `${Math.max(1, Math.min(score || 0, 100))}%`;

  return (
    <div className="metric-row">
      <div className="metric-copy">
        <div className="metric-topline">
          <span className="metric-name">{title}</span>
          <span className={`metric-score is-${tone}`}>{score === null ? "Not assessed" : `${score}/100`}</span>
        </div>
        <div className="metric-track" aria-hidden="true"><span className={`is-${tone}`} style={{ width: meterWidth }} /></div>
        <span className="metric-model">{modelLabel}</span>
        <span className={`metric-detail is-${tone}`}>{strength}{score === null ? "" : ` · ${evidenceLabel}`}</span>
        {signals.length > 0 && (
          <div className="metric-signal-list" aria-label={`${title} evidence cues`}>
            {signals.map((signal) => (
              <button className="signal-chip" type="button" key={signal.id} onClick={() => onSignalSelect?.(signal.id)}>
                “{signal.phrase}”
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BiasSummary({ assessment, onSignalSelect }: { assessment?: BackendBiasAnalysis; onSignalSelect?: (signalId: string) => void }) {
  if (!assessment) return null;
  const isFallback = assessment.source === "local-fallback";
  const signalsFor = (dimension: BiasDimension) => assessment.linguistic_evidence.signals.filter((signal) => signal.dimension === dimension);
  const modelLabels = isFallback
    ? {
        political: "Heuristic fallback: lexical spin-word rules",
        gender: "Heuristic fallback: gendered-language association rules",
        ethnicity: "Heuristic fallback: demographic-hostility association rules"
      }
    : {
        political: "Model: mediabiasgroup/roberta-babe-ft",
        gender: "Models: distilbert-base-uncased-finetuned-sst-2-english + optional COREF_BIAS_MODEL",
        ethnicity: "Models: unitary/unbiased-toxic-roberta + distilbert-base-uncased-finetuned-sst-2-english"
      };
  return (
    <section className="surface result-section">
      <div className="section-heading">
        <div className="heading-with-badge">
          <h2>Bias signals</h2>
          {isFallback && <span className="fallback-badge">Heuristic fallback</span>}
        </div>
        <p>
          {isFallback
            ? "Backend models did not respond in time, so these are marked heuristic estimates. Click a cue to inspect the cited passage."
            : "Direct wording cues by category. Click a cue to inspect the cited passage."}
        </p>
      </div>
      <div className="metric-list">
        <MetricRow title="Political bias" metric={assessment.scores.political_bias} modelLabel={modelLabels.political} signals={signalsFor("political")} onSignalSelect={onSignalSelect} />
        <MetricRow title="Gender bias" metric={assessment.scores.gender_bias} modelLabel={modelLabels.gender} signals={signalsFor("gender")} onSignalSelect={onSignalSelect} />
        <MetricRow title="Ethnicity bias" metric={assessment.scores.ethnicity_bias} modelLabel={modelLabels.ethnicity} signals={signalsFor("ethnicity")} onSignalSelect={onSignalSelect} />
      </div>
    </section>
  );
}

const plainLanguageReplacements: Array<[RegExp, string]> = [
  [/\blegislation\b/gi, "bill"],
  [/\bstatute\b/gi, "law"],
  [/\bauthorize\b/gi, "allow"],
  [/\bauthorizes\b/gi, "allows"],
  [/\bauthorized\b/gi, "allowed"],
  [/\bappropriate\b/gi, "set aside money"],
  [/\bappropriates\b/gi, "sets aside money"],
  [/\bprohibit\b/gi, "ban"],
  [/\bprohibits\b/gi, "bans"],
  [/\brequire\b/gi, "make"],
  [/\brequires\b/gi, "makes"],
  [/\bestablish\b/gi, "create"],
  [/\bestablishes\b/gi, "creates"],
  [/\bimplement\b/gi, "put into action"],
  [/\bimplementation\b/gi, "how it would be put into action"],
  [/\bpursuant to\b/gi, "under"],
  [/\bprior to\b/gi, "before"],
  [/\bsubsequent to\b/gi, "after"]
];

function highSchoolPlainText(value: string) {
  let text = value.replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of plainLanguageReplacements) {
    text = text.replace(pattern, replacement);
  }
  const sentences = text.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
  return sentences.length > 360 ? `${sentences.slice(0, 357).trimEnd()}...` : sentences;
}

function lowercaseFirst(value: string) {
  return value ? `${value[0].toLowerCase()}${value.slice(1)}` : value;
}

function plainBillAction(value: string) {
  let text = highSchoolPlainText(value)
    .replace(/^section\s+\d+[a-z]?\.\s*/i, "")
    .replace(/^sec\.\s*\d+[a-z]?\.\s*/i, "")
    .replace(/\bshall\b/gi, "would")
    .replace(/\bis amended by\b/gi, "would be changed by")
    .replace(/\bare amended by\b/gi, "would be changed by")
    .trim();

  if (/^to\s+/i.test(text)) text = `would ${text.replace(/^to\s+/i, "")}`;
  if (/^(this bill|the bill|this act|the secretary|secretary|the department|the agency|the administrator)\b/i.test(text)) return text;
  if (/^would\b/i.test(text)) return `It ${text}`;
  return `It would ${lowercaseFirst(text)}`;
}

function plainEnglishFor(analysis: Analysis) {
  if (analysis.contentType !== "bill") {
    return {
      intro: "A short version of what this article is about, using simpler words.",
      lines: [highSchoolPlainText(analysis.summary)]
    };
  }

  const bill = analysis as BillAnalysis;
  const actionableChanges = bill.proposedChanges
    .filter((item) => !/^no clear/i.test(item.text))
    .slice(0, 3)
    .map((item) => plainBillAction(item.text));

  return {
    intro: "What this bill proposes to put into action.",
    lines: actionableChanges.length ? actionableChanges : [highSchoolPlainText(bill.plainLanguageSummary || analysis.summary)]
  };
}

function PlainEnglishSummary({ analysis }: { analysis: Analysis }) {
  const plainEnglish = plainEnglishFor(analysis);
  const evidenceCount = analysis.summaryEvidenceIds.length;
  const evidenceLabel = evidenceCount === 1 ? "1 cited passage" : `${evidenceCount} cited passages`;

  return (
    <section className="surface result-section plain-english-section">
      <div className="section-heading">
        <h2>Summary</h2>
        <p>{plainEnglish.intro}</p>
      </div>
      <div className="plain-summary-card">
        {analysis.contentType === "bill" && plainEnglish.lines.length > 1 ? (
          <ul>
            {plainEnglish.lines.map((line) => <li key={line}>{line}</li>)}
          </ul>
        ) : (
          <p>{plainEnglish.lines[0]}</p>
        )}
        <span>{evidenceCount > 0 ? `Based on ${evidenceLabel}.` : "Based on the readable extracted text."}</span>
      </div>
    </section>
  );
}

function vocabularyTermsFor(analysis: Analysis): VocabularyTerm[] {
  const terms = new Map<string, VocabularyTerm>();
  const addTerm = (term: string, definition: string, source: string, context?: string, force = false) => {
    const cleaned = term.replace(/\s+/g, " ").trim();
    if (!cleaned || cleaned.length < 3) return;
    if (!force && !shouldShowVocabularyTerm(cleaned, source)) return;
    const key = cleaned.toLowerCase();
    if (!terms.has(key)) terms.set(key, { term: cleaned, definition: highSchoolPlainText(definition), source, context });
  };

  if (analysis.contentType === "bill") {
    for (const item of (analysis as BillAnalysis).importantTerms) {
      addTerm(item.term, item.meaning, "Bill term", firstEvidence(analysis, item)?.supportingText, true);
    }
  } else {
    for (const item of analysis.loadedLanguageExamples.slice(0, 4)) {
      if (!shouldShowVocabularyTerm(item.phrase, "Article wording")) continue;
      addTerm(item.phrase, "A word choice that may shape how readers feel about the topic. It may still be accurate, but it is worth checking the evidence around it.", "Article wording", item.context);
    }
  }

  for (const signal of analysis.backendBias?.linguistic_evidence.signals || []) {
    if (!shouldShowVocabularyTerm(signal.phrase, "Bias signal")) continue;
    const definition = signal.category === "epistemic_framing"
      ? "A reporting word that can make a source sound more or less believable, certain, or reluctant."
      : signal.category === "stereotype_association"
        ? "A word or phrase that may connect a group with a negative or stereotyped idea."
        : "A word or phrase that can add emotional force to the sentence.";
    addTerm(signal.phrase, definition, "Bias signal", signal.context);
  }

  const sourceTextRaw = [
    analysis.summary,
    ...analysis.evidence.map((item) => item.supportingText)
  ].join(" ");
  const sourceText = sourceTextRaw.toLowerCase();
  for (const [term, definition] of Object.entries(glossaryDefinitions)) {
    if (terms.size >= 10) break;
    if (new RegExp(`\\b${term}\\b`, "i").test(sourceText)) addTerm(term, definition, "Plain-English glossary", undefined, true);
  }

  for (const match of sourceTextRaw.matchAll(policyPhraseGlobalPattern)) {
    if (terms.size >= 10) break;
    const phrase = match[0];
    addTerm(phrase, definitionForPolicyPhrase(phrase), "Plain-English glossary", undefined, true);
  }

  const acronymMatches = Array.from(new Set(sourceTextRaw.match(/\b[A-Z]{2,6}\b/g) || []))
    .filter((term) => !["THE", "AND", "FOR", "WITH", "THIS", "THAT", "SAYS", "SAID"].includes(term))
    .filter((term) => analysis.contentType === "bill" || sourceTextRaw.includes(`(${term})`))
    .slice(0, 2);
  for (const acronym of acronymMatches) {
    addTerm(acronym, "An abbreviation. Look for the full name nearby in the article or bill, because abbreviations can hide what agency, program, or rule is being discussed.", "Abbreviation", undefined, true);
  }

  return Array.from(terms.values()).slice(0, 12);
}

function shouldShowVocabularyTerm(term: string, source: string) {
  const cleaned = term.trim().toLowerCase();
  if (difficultTermSources.has(source)) return true;
  if (glossaryDefinitions[cleaned]) return true;
  if (policyPhrasePattern.test(cleaned)) return true;
  if (/\s/.test(cleaned) && /\b(policy|program|requirement|construction|overreach|shortage|freeze|credit|penalty|benefit|funding|enforcement)\b/i.test(cleaned)) return true;
  return false;
}

function definitionForPolicyPhrase(value: string) {
  const phrase = value.toLowerCase();
  if (phrase === "rent freeze") return "A rule that stops rent from going up for a set time.";
  if (phrase === "government overreach") return "A claim that the government is using too much power or going beyond what it should control.";
  if (phrase === "housing shortage") return "A situation where there are not enough homes available for the people who need them.";
  if (phrase === "new construction") return "New buildings or homes being built.";
  if (phrase === "property owners") return "People or companies that own land or buildings.";
  if (phrase === "reporting requirement") return "A rule that makes a person, company, or agency provide information on a regular basis.";
  if (phrase === "effective date") return "The date when a law or rule starts to apply.";
  if (phrase === "tax credit") return "An amount that lowers how much tax someone has to pay.";
  if (phrase === "grant program") return "A program that gives money for a specific purpose.";
  if (phrase === "public benefit") return "Help or support provided to people by the government.";
  if (phrase === "civil penalty") return "A fine or punishment for breaking a rule that is not treated as a criminal case.";
  if (phrase === "housing crisis") return "A serious housing problem, often involving high costs, homelessness, or too few available homes.";
  return "A policy phrase whose exact meaning depends on how the source uses it.";
}

function localVocabularyAnswer(question: string, analysis: Analysis, terms: VocabularyTerm[]) {
  const cleaned = question.trim().replace(/[?.!,;:"']+$/g, "");
  const lower = cleaned.toLowerCase();
  const matched = terms.find((item) => lower.includes(item.term.toLowerCase()) || item.term.toLowerCase().includes(lower));
  if (matched) {
    return `"${matched.term}" means: ${matched.definition}`;
  }

  const glossaryMatch = Object.entries(glossaryDefinitions).find(([term]) => lower.includes(term) || term.includes(lower));
  if (glossaryMatch) {
    return `"${glossaryMatch[0]}" means: ${glossaryMatch[1]}`;
  }

  const typeHint = analysis.contentType === "bill"
    ? "For a bill, ask whether the word creates a program, changes a law, spends money, bans something, or requires someone to act."
    : "For an article, ask whether the word is being used as a fact, a quote, an opinion, or a loaded description.";
  return `I do not have a saved definition for "${cleaned || "that word"}" yet. A good plain-English check is: what action is happening, who is affected, and what evidence or rule supports it? ${typeHint}`;
}

function VocabularyView({ analysis }: { analysis: Analysis | null }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);

  useEffect(() => { setQuestion(""); setAnswer(null); }, [analysis?.id]);

  if (!analysis) return <section className="surface empty-state"><BookOpenText size={22} /><p>Analyze a source to define important terms from it.</p></section>;
  const terms = vocabularyTermsFor(analysis);

  function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!analysis || !question.trim()) return;
    setAnswer(localVocabularyAnswer(question, analysis, terms));
  }

  return (
    <section className="surface vocabulary-view">
      <div className="section-heading">
        <h1>Vocabulary</h1>
        <p>Plain-English definitions for terms that may be confusing in this source.</p>
      </div>

      {terms.length ? (
        <ul className="vocabulary-list">
          {terms.map((item) => (
            <li key={`${item.source}-${item.term}`}>
              <div>
                <strong>{item.term}</strong>
                <span>{item.source}</span>
              </div>
              <p>{item.definition}</p>
              {item.context && <blockquote>{item.context}</blockquote>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="helper">No specific terms were extracted yet. You can still ask about a word below.</p>
      )}

      <form className="vocabulary-ask" onSubmit={submitQuestion}>
        <div className="field">
          <label htmlFor="vocabulary-question">Ask about another word</label>
          <input id="vocabulary-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="e.g. What does appropriation mean here?" />
          <p className="helper">This vocabulary helper stays local in the extension. Backend/model calls are only used for bias detection.</p>
        </div>
        <button className="secondary-button" type="submit" disabled={!question.trim()}>Ask</button>
        {answer && (
          <div className="vocabulary-answer" role="status">
            <strong>Local vocabulary helper</strong>
            <p>{answer}</p>
          </div>
        )}
      </form>
    </section>
  );
}

function AnalysisView({ analysis, onNewAnalysis, onSaveAnalysis, onSignalSelect }: { analysis: Analysis; onNewAnalysis: () => void; onSaveAnalysis: () => void; onSignalSelect: (signalId: string) => void }) {
  const sourceIsLink = /^https?:\/\//.test(analysis.url);
  const keyFindings = primaryFindingsFor(analysis);

  return (
    <div className="result-stack">
      {analysis.confidenceScore < 50 && (
        <div className="warning-panel" role="status">
          <strong>Limited extraction</strong>
          <p>Use the cited passages as reading prompts, not verified conclusions.</p>
        </div>
      )}

      <section className="surface source-summary">
        <div className="source-heading">
          <div>
            <h1>{analysis.pageTitle}</h1>
            <p className="meta-line">
              <span>{analysis.sourceName}</span>
              <span>{contentLabel(analysis.contentType)}</span>
              {analysis.contentType === "article" && <span>{genreLabel(analysis.genre || "general")}</span>}
              <span>Confidence: {confidenceLabel(analysis.confidenceScore)}</span>
            </p>
          </div>
        </div>
        <div className="source-actions">
          <button className="primary-button" type="button" onClick={onSaveAnalysis}><FloppyDisk size={16} /> Save</button>
          <button className="secondary-button" type="button" onClick={onNewAnalysis}>New</button>
          {sourceIsLink && <a className="text-link" href={analysis.url} target="_blank" rel="noreferrer"><LinkSimple size={15} /> Source</a>}
        </div>
      </section>

      <PlainEnglishSummary analysis={analysis} />

      <BiasSummary assessment={analysis.backendBias} onSignalSelect={onSignalSelect} />

      <section className="surface result-section">
        <div className="section-heading">
          <h2>Main framing</h2>
          <p>Up to three evidence-linked prompts from this source.</p>
        </div>
        {keyFindings.length ? (
          <ol className="key-findings">
            {keyFindings.map((finding, index) => {
              const repeatsFinding = finding.context?.trim().toLowerCase() === finding.text.trim().toLowerCase();
              return (
                <li key={`${finding.text}-${index}`}>
                  <p>{finding.text}</p>
                  {finding.context && !repeatsFinding && <blockquote>{finding.context}</blockquote>}
                  {finding.signalId && (
                    <button className="evidence-jump" type="button" onClick={() => onSignalSelect(finding.signalId as string)}>
                      View cited passage
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="helper">No strong local signal was detected. This is not a neutrality rating.</p>
        )}
      </section>

      <p className="result-note">Ellipsis shows framing signals and missing context prompts. It does not tell you what to believe.</p>
    </div>
  );
}

function FindingGroup({ title, items }: { title: string; items: AnalysisFinding[] }) {
  if (!items.length) return null;
  return (
    <div className="detail-group">
      <h3>{title}</h3>
      <ul>
        {items.map((item, index) => <li key={`${item.text}-${index}`}>{item.text}</li>)}
      </ul>
    </div>
  );
}

function SourceBreakdown({ analysis }: { analysis: Analysis }) {
  if (analysis.contentType === "bill") {
    const bill = analysis as BillAnalysis;
    return (
      <>
        <div className="detail-group"><h3>{bill.billNumber}</h3><p>{bill.billTitle}</p></div>
        <FindingGroup title="Main issue" items={[bill.mainIssue]} />
        <FindingGroup title="What it would change" items={bill.proposedChanges} />
        <FindingGroup title="Potentially affected groups" items={bill.affectedGroups} />
        <FindingGroup title="Unclear impacts" items={bill.unclearImpacts} />
        <FindingGroup title="Sourced supporters" items={bill.sourcedSupporters} />
        <FindingGroup title="Sourced opponents" items={bill.sourcedOpponents} />
        {bill.importantTerms.length > 0 && (
          <div className="detail-group"><h3>Important terms</h3><ul>{bill.importantTerms.map((item) => <li key={item.term}><strong>{item.term}:</strong> {item.meaning}</li>)}</ul></div>
        )}
      </>
    );
  }

  return (
    <>
      <FindingGroup title="Main issue" items={[analysis.mainIssue]} />
      <FindingGroup title="Framing prompts" items={analysis.framingNotes} />
      <FindingGroup title="Potentially loaded wording" items={analysis.loadedLanguageExamples} />
      <FindingGroup title="Included perspectives" items={analysis.includedPerspectives} />
      <FindingGroup title="Questions to check" items={analysis.missingPerspectives} />
      <FindingGroup title="Attributed sources" items={analysis.quotedPeopleOrGroups} />
    </>
  );
}

function EvidenceList({ analysis }: { analysis: Analysis }) {
  const unique = new Map<string, Analysis["evidence"][number]>();
  for (const item of analysis.evidence) {
    const key = `${item.kind}:${item.supportingText.trim().toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return (
    <ul className="evidence-list">
      {Array.from(unique.values()).map((item) => (
        <li key={item.id}>
          <strong>{item.claim}</strong>
          <blockquote>{item.supportingText}</blockquote>
          <p>{item.explanation}</p>
          <span>{item.kind === "source_text" ? "Source text" : item.kind === "outside_context" ? "Outside context" : "Analysis note"} · {item.confidenceLabel} confidence</span>
        </li>
      ))}
    </ul>
  );
}

function FeedbackDisclosure({ analysis }: { analysis: Analysis }) {
  const [selected, setSelected] = useState<FeedbackType | null>(null);
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => { setSelected(null); setComment(""); setStatus(null); }, [analysis.id]);

  async function submitFeedback() {
    if (!selected) return;
    try {
      await logFeedback({
        id: `feedback_${Date.now().toString(36)}`,
        analysisId: analysis.id,
        url: analysis.url,
        contentType: analysis.contentType,
        feedbackType: selected,
        optionalComment: comment.trim(),
        confidenceScore: analysis.confidenceScore,
        createdAt: new Date().toISOString()
      });
      setSelected(null);
      setComment("");
      setStatus("Feedback saved on this device.");
    } catch {
      setStatus("Feedback could not be saved.");
    }
  }

  async function clearFeedback() {
    if (!window.confirm("Delete all feedback saved on this device?")) return;
    try {
      await clearFeedbackLogs();
      setStatus("Local feedback cleared.");
    } catch {
      setStatus("Local feedback could not be cleared.");
    }
  }

  return (
    <details className="disclosure">
      <summary>Report a problem</summary>
      <div className="disclosure-body">
        <p className="helper">This remains on your device and is not sent to the team yet. Do not include personal information.</p>
        {status && <div className="notice-panel" role="status">{status}</div>}
        <div className="feedback-grid">
          {feedbackTypes.map((type) => (
            <button className={`choice-button ${selected === type ? "is-selected" : ""}`} type="button" aria-pressed={selected === type} key={type} onClick={() => { setSelected(type); setStatus(null); }}>{type}</button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="feedback-comment">Optional comment</label>
          <textarea id="feedback-comment" maxLength={1000} value={comment} onChange={(event) => setComment(event.target.value)} />
        </div>
        <div className="actions">
          <button className="primary-button" type="button" disabled={!selected} onClick={submitFeedback}>Save locally</button>
          <button className="secondary-button" type="button" onClick={clearFeedback}>Clear feedback</button>
        </div>
      </div>
    </details>
  );
}

function DetailsView({ analysis, focusedSignalId }: { analysis: Analysis | null; focusedSignalId: string | null }) {
  if (!analysis) return <section className="surface empty-state"><Info size={22} /><p>Analyze a source to inspect evidence and method details.</p></section>;
  const signals = analysis.backendBias?.linguistic_evidence.signals || [];
  return (
    <section className="surface details-view">
      <div className="details-intro">
        <h1>Analysis details</h1>
        <p>{analysis.confidenceReason}</p>
        <dl>
          <div><dt>Overall confidence</dt><dd>{analysis.confidenceScore}%</dd></div>
          <div><dt>Analysis mode</dt><dd>{analysis.backendBias?.source === "local-fallback" ? "Heuristic fallback" : "Backend models"}</dd></div>
          <div><dt>Saved text</dt><dd>Only excerpts in a saved result</dd></div>
        </dl>
        {analysis.backendBias?.source === "local-fallback" && (
          <p className="fallback-note">Backend model scoring was unavailable, so bias scores are lower-confidence heuristic estimates.</p>
        )}
      </div>

      <details className="disclosure" open>
        <summary>Bias signal evidence ({signals.length})</summary>
        <div className="disclosure-body">
          {signals.length ? (
            <ul className="signal-list">
              {signals.map((signal) => (
                <li id={signalElementId(signal.id)} className={focusedSignalId === signal.id ? "is-highlighted" : ""} key={signal.id}>
                  <strong>{dimensionTitle(signal.dimension)}: “{signal.phrase}”</strong>
                  <blockquote>{signal.context}</blockquote>
                  <p>{signal.explanation}</p>
                  {signal.neutralAlternative && <p><strong>Check:</strong> {signal.neutralAlternative}</p>}
                </li>
              ))}
            </ul>
          ) : <p className="helper">No direct wording or stereotype association met the evidence threshold.</p>}
        </div>
      </details>

      <details className="disclosure">
        <summary>Full source breakdown</summary>
        <div className="disclosure-body"><SourceBreakdown analysis={analysis} /></div>
      </details>

      <details className="disclosure">
        <summary>Evidence and parser notes ({analysis.evidence.length})</summary>
        <div className="disclosure-body"><EvidenceList analysis={analysis} /></div>
      </details>

      <FeedbackDisclosure analysis={analysis} />
    </section>
  );
}

function dimensionTitle(dimension: BiasDimension) {
  if (dimension === "gender") return "Gender framing";
  if (dimension === "ethnicity") return "Ethnicity framing";
  return "Political wording";
}

function HistoryView({ saved, onOpen, onDelete, onClear }: { saved: SavedAnalysis[]; onOpen: (analysis: Analysis) => void; onDelete: (id: string) => void; onClear: () => void }) {
  return (
    <section className="surface history-view">
      <div className="history-heading">
        <div><h1>Saved</h1><p>{saved.length} of 50 analyses stored on this device.</p></div>
        {saved.length > 0 && <button className="secondary-button" type="button" onClick={onClear}>Clear all</button>}
      </div>
      {saved.length ? (
        <ul className="history-list">
          {saved.map((item) => (
            <li key={item.id}>
              <button className="history-open" type="button" onClick={() => onOpen(item.analysis)}>
                <strong>{item.pageTitle}</strong>
                <span>{item.summary}</span>
                <small>{contentLabel(item.contentType)} · {formatDate(item.createdAt)}</small>
              </button>
              <button className="icon-button" type="button" aria-label={`Delete ${item.pageTitle}`} onClick={() => onDelete(item.id)}><Trash size={16} /></button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-state"><ClockCounterClockwise size={22} /><p>Save an analysis to build a private reading history.</p></div>
      )}
    </section>
  );
}

function StartView({ loading, onAnalyzePage, onAnalyzeUrl, onAnalyzeText }: {
  loading: boolean;
  onAnalyzePage: () => void;
  onAnalyzeUrl: (url: string) => void;
  onAnalyzeText: (text: string, type: ContentType, metadata: { title?: string; url?: string; sourceName?: string }) => void;
}) {
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [type, setType] = useState<ContentType>("unknown");
  const [title, setTitle] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const inferredType = useMemo(() => classifyPastedText(text, sourceUrl), [text, sourceUrl]);

  function submitUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const normalized = normalizeWebUrl(url);
      setUrlError(null);
      onAnalyzeUrl(normalized);
    } catch (error) {
      setUrlError(error instanceof Error ? error.message : "Enter a valid link.");
    }
  }

  function submitText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (text.trim().length < 120) return;
    onAnalyzeText(text, type === "unknown" ? inferredType : type, { title, sourceName, url: sourceUrl });
  }

  return (
    <section className="surface start-view">
      <div className="start-primary">
        <h1>Understand what you are reading</h1>
        <p>Get three evidence-linked checks for a news article or Congress.gov bill.</p>
        <p className="mode-helper">Uses the local Python model helper at 127.0.0.1:8000 when available. If it does not respond, scores are clearly marked as heuristic fallback estimates.</p>
        <button className="primary-button full-button" type="button" onClick={onAnalyzePage} disabled={loading}><MagnifyingGlass size={16} /> Analyze current page</button>
      </div>

      <form className="url-form" onSubmit={submitUrl}>
        <label htmlFor="source-link">Or analyze a link</label>
        <div className="inline-field">
          <input id="source-link" inputMode="url" value={url} onChange={(event) => { setUrl(event.target.value); setUrlError(null); }} placeholder="https://..." />
          <button className="secondary-button" type="submit" disabled={!url.trim() || loading}>Analyze</button>
        </div>
        {urlError && <p className="field-error">{urlError}</p>}
      </form>

      <details className="disclosure paste-disclosure">
        <summary>Paste text instead</summary>
        <form className="disclosure-body" onSubmit={submitText}>
          <div className="field">
            <label htmlFor="manual-text">Article or bill text</label>
            <textarea id="manual-text" value={text} onChange={(event) => setText(event.target.value)} />
            <p className="helper">Paste at least 120 characters. Current guess: {contentLabel(inferredType)}.</p>
          </div>
          <div className="field">
            <label htmlFor="content-type">Content type</label>
            <select id="content-type" value={type} onChange={(event) => setType(event.target.value as ContentType)}>
              <option value="unknown">Detect from text</option>
              <option value="article">News article</option>
              <option value="bill">Congress.gov bill</option>
            </select>
          </div>
          <details className="minor-disclosure">
            <summary>Optional source details</summary>
            <div className="optional-fields">
              <div className="field"><label htmlFor="manual-title">Title</label><input id="manual-title" value={title} onChange={(event) => setTitle(event.target.value)} /></div>
              <div className="field"><label htmlFor="manual-source">Outlet or source</label><input id="manual-source" value={sourceName} onChange={(event) => setSourceName(event.target.value)} /></div>
              <div className="field"><label htmlFor="manual-url">Source link</label><input id="manual-url" inputMode="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} /></div>
            </div>
          </details>
          <button className="secondary-button" type="submit" disabled={text.trim().length < 120 || loading}>Analyze pasted text</button>
        </form>
      </details>

      <div className="privacy-note">
        <strong>Private by default</strong>
        <p>Analysis stays on this device. Link analysis requests the page directly. Article text is never sent to Ellipsis or a third-party AI. An optional model helper is accepted only on this computer.</p>
      </div>
    </section>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("analysis");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [saved, setSaved] = useState<SavedAnalysis[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusedSignalId, setFocusedSignalId] = useState<string | null>(null);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);

  useEffect(() => { getSavedAnalyses().then(setSaved).catch(() => setError("Saved history could not be loaded.")); }, []);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      getBackendStatus().then((status) => {
        if (active) setBackendStatus(status);
      }).catch(() => {
        if (active) setBackendStatus({ state: "offline", label: "Backend offline" });
      });
    };
    refresh();
    const interval = window.setInterval(refresh, 15000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  function selectSignal(signalId: string) {
    const signal = analysis?.backendBias?.linguistic_evidence.signals.find((item) => item.id === signalId);
    setFocusedSignalId(signalId);
    if (signal?.context) {
      highlightActivePagePassage(signal.context).then((highlighted) => {
        if (!highlighted && /^https?:\/\//.test(analysis?.url || "")) {
          setNotice("I could not match that exact passage on the open page, so I highlighted it in Details instead.");
        }
      }).catch(() => undefined);
    }
    setActiveTab("details");
    window.setTimeout(() => {
      document.getElementById(signalElementId(signalId))?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
    window.setTimeout(() => {
      setFocusedSignalId((current) => current === signalId ? null : current);
    }, 2600);
  }

  async function analyze(pagePromise: Promise<ReturnType<typeof createManualPage>>) {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const page = await pagePromise;
      if (page.text.trim().length < 120) throw new Error("The readable text was too short. Try the link option or paste the source text.");
      const nextAnalysis = await analyzePageWithBackend(page);
      setAnalysis(nextAnalysis);
      setBackendStatus(nextAnalysis.backendBias?.source === "local-fallback" ? { state: "offline", label: "Backend offline" } : { state: "ready", label: "Backend ready" });
      setFocusedSignalId(null);
      setActiveTab("analysis");
    } catch (event) {
      setError(event instanceof Error ? event.message : "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  function runPageAnalysis() {
    void analyze(extractActivePage());
  }

  function runUrlAnalysis(url: string) {
    void analyze(fetchPageFromUrl(url));
  }

  function runManualAnalysis(text: string, type: ContentType, metadata: { title?: string; url?: string; sourceName?: string }) {
    void analyze(Promise.resolve(createManualPage(text, type, metadata)));
  }

  async function saveCurrentAnalysis() {
    if (!analysis) return;
    try {
      const result = await saveAnalysis(toSavedAnalysis(analysis), () => window.confirm("You already have 50 saved analyses. Delete the oldest item to make room?"));
      if (result.saved) {
        setSaved(await getSavedAnalyses());
        setNotice("Analysis saved on this device.");
      } else {
        setNotice("Analysis was not saved.");
      }
    } catch {
      setError("The analysis could not be saved.");
    }
  }

  async function removeSaved(id: string) {
    try {
      setSaved(await deleteSavedAnalysis(id));
      setNotice("Saved analysis deleted.");
    } catch {
      setError("The saved analysis could not be deleted.");
    }
  }

  async function clearHistory() {
    if (!window.confirm("Delete all saved analyses from this device?")) return;
    try {
      setSaved(await clearSavedAnalyses());
      setNotice("Saved history cleared.");
    } catch {
      setError("Saved history could not be cleared.");
    }
  }

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: "analysis", label: analysis ? "Overview" : "Analyze", icon: <FileText size={15} /> },
    { id: "vocabulary", label: "Language", icon: <BookOpenText size={15} /> },
    { id: "saved", label: "Saved", icon: <ClockCounterClockwise size={15} /> },
    { id: "details", label: "Sources", icon: <Info size={15} /> }
  ];

  function moveTab(event: React.KeyboardEvent<HTMLButtonElement>, current: Tab) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === current);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const next = tabs[nextIndex].id;
    setActiveTab(next);
    requestAnimationFrame(() => document.getElementById(`tab-${next}`)?.focus());
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <span className="brand-lockup">
          <img className="brand-icon" src="/icons/ellipsis-32.png" alt="" aria-hidden="true" />
          <span className="brand-name">Ellipsis</span>
        </span>
        <BackendStatusPill status={backendStatus} fallback={analysis?.backendBias?.source === "local-fallback"} />
        <button className="primary-button" type="button" onClick={runPageAnalysis} disabled={loading}><MagnifyingGlass size={15} /> Analyze page</button>
      </header>
      <div className="content">
        <nav className="tabs" role="tablist" aria-label="Ellipsis sections">
          {tabs.map((tab) => (
            <button id={`tab-${tab.id}`} key={tab.id} className={`tab-button ${activeTab === tab.id ? "is-active" : ""}`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`panel-${tab.id}`} tabIndex={activeTab === tab.id ? 0 : -1} onKeyDown={(event) => moveTab(event, tab.id)} onClick={() => { setActiveTab(tab.id); setNotice(null); }}>{tab.icon}{tab.label}</button>
          ))}
        </nav>
        {error && activeTab === "analysis" && <div className="error-panel" role="alert"><strong><WarningCircle size={16} /> Issue</strong><p>{error}</p></div>}
        {notice && <div className="notice-panel" role="status">{notice}</div>}
        {loading ? <LoadingState /> : (
          <section id={`panel-${activeTab}`} role="tabpanel" aria-labelledby={`tab-${activeTab}`}>
            {activeTab === "analysis" && (analysis
              ? <AnalysisView analysis={analysis} onSaveAnalysis={saveCurrentAnalysis} onSignalSelect={selectSignal} onNewAnalysis={() => { setAnalysis(null); setFocusedSignalId(null); setError(null); setNotice(null); }} />
              : <StartView loading={loading} onAnalyzePage={runPageAnalysis} onAnalyzeUrl={runUrlAnalysis} onAnalyzeText={runManualAnalysis} />)}
            {activeTab === "vocabulary" && <VocabularyView analysis={analysis} />}
            {activeTab === "saved" && <HistoryView saved={saved} onOpen={(next) => { setAnalysis(next); setFocusedSignalId(null); setActiveTab("analysis"); }} onDelete={removeSaved} onClear={clearHistory} />}
            {activeTab === "details" && <DetailsView analysis={analysis} focusedSignalId={focusedSignalId} />}
          </section>
        )}
      </div>
    </main>
  );
}
