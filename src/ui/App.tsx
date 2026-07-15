import {
  ArrowClockwise,
  Brain,
  BookOpenText,
  CheckCircle,
  ClockCounterClockwise,
  Cpu,
  FileText,
  FloppyDisk,
  GearSix,
  GlobeSimple,
  LinkSimple,
  MagnifyingGlass,
  Question,
  ShieldCheck,
  Trash,
  WarningCircle,
  X
} from "@phosphor-icons/react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { classifyPastedText, confidenceLabel } from "../lib/analysis";
import { beginAiLogin, checkAiConnection, subscribeAiProgress } from "../lib/ai";
import { analyzePageWithBackend, biasProfileFromAssessment } from "../lib/backend";
import { createManualPage, extractActivePage, highlightActivePagePassage } from "../lib/chrome";
import { sourceRoleLabel } from "../lib/sources";
import {
  clearFeedbackLogs,
  clearSavedAnalyses,
  deleteSavedAnalysis,
  getAiSettings,
  getSavedAnalyses,
  logFeedback,
  saveAiSettings,
  saveAnalysis
} from "../lib/storage";
import { fetchPageFromUrl, normalizeWebUrl } from "../lib/url";
import type {
  Analysis,
  AnalysisFinding,
  AnalysisTraceEvent,
  AiConnectionStatus,
  AiLoginResult,
  AiProvider,
  AiSettings,
  ArticleSource,
  ArticleGenre,
  BillAnalysis,
  ContentType,
  ExtractedPage,
  FactCheckStatus,
  FeedbackType,
  SavedAnalysis
} from "../types";
import { BiasProfileBand, BiasSignalChart, FramingBars } from "./components/InsightCharts";

type AppView = "analysis" | "saved";
type AnalysisSection = "overview" | "language" | "voices" | "evidence";

const feedbackTypes: FeedbackType[] = ["Helpful", "Confusing", "Incorrect", "Biased"];

const aiProviderMeta = {
  codex: {
    label: "Codex",
    model: "GPT-5.5",
    reasoning: "Low",
    runtime: "Codex app-server",
    tools: "Built-in web search only"
  },
  claude: {
    label: "Claude Code",
    model: "Claude Sonnet 4.6",
    reasoning: "Low",
    runtime: "Claude Code CLI",
    tools: "Web search and source fetch"
  }
} satisfies Record<AiProvider, { label: string; model: string; reasoning: string; runtime: string; tools: string }>;

function unavailableAiStatus(provider: AiProvider, message: string): AiConnectionStatus {
  const meta = aiProviderMeta[provider];
  return {
    provider,
    providerStatus: "unavailable",
    providerMessage: message,
    model: provider === "claude" ? "claude-sonnet-4-6" : "gpt-5.5",
    reasoningEffort: "low",
    runtime: meta.runtime,
    checkedAt: new Date().toISOString()
  };
}

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

function formatRuntime(milliseconds: number) {
  if (milliseconds < 1_000) return `${milliseconds}ms`;
  return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`;
}

function RuntimeTimer({ startedAt }: { startedAt: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const update = () => { if (ref.current) ref.current.textContent = formatRuntime(Date.now() - startedAt); };
    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [startedAt]);
  return <span ref={ref} className="tabular-number">0ms</span>;
}

function TraceIcon({ event }: { event: AnalysisTraceEvent }) {
  if (event.status === "failed") return <WarningCircle size={15} />;
  if (event.kind === "reasoning") return <Brain size={15} />;
  if (event.kind === "tool") return <GlobeSimple size={15} />;
  if (event.id === "agent-output") return <FileText size={15} />;
  if (event.id === "codex-retry") return <ArrowClockwise size={15} />;
  if (event.status === "completed") return <CheckCircle size={15} weight="fill" />;
  return <Cpu size={15} />;
}

function TraceList({ trace }: { trace: AnalysisTraceEvent[] }) {
  const fixedOrder: Record<string, number> = {
    "gather-source": 10,
    "ai-analysis": 20,
    "codex-retry": 70,
    "agent-output": 90
  };
  const orderedTrace = [...trace].sort((left, right) => {
    const leftOrder = fixedOrder[left.id] ?? 50;
    const rightOrder = fixedOrder[right.id] ?? 50;
    return leftOrder - rightOrder || left.at.localeCompare(right.at);
  });
  return (
    <ol className="trace-list">
      {orderedTrace.map((event) => (
        <li className={`trace-row is-${event.status} is-${event.kind} ${event.parentId ? "is-child" : "is-runtime"}`} key={event.id}>
          <span className="trace-icon"><TraceIcon event={event} /></span>
          <div>
            <p><strong>{event.title}</strong>{!event.parentId && event.status === "running" && <RuntimeTimer startedAt={new Date(event.startedAt || event.at).getTime()} />}{!event.parentId && event.durationMs !== undefined && <span>{formatRuntime(event.durationMs)}</span>}</p>
            {event.detail && <p className="trace-detail">{event.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function LoadingState({ aiEnabled, trace }: { aiEnabled: boolean; trace: AnalysisTraceEvent[] }) {
  return (
    <section className="surface loading-state analysis-trace" aria-live="polite">
      <header className="trace-header">
        <div><strong>Analyzing source</strong><span>{aiEnabled ? "Gathering text, researching claims, and producing the AI analysis" : "Gathering text and producing the local analysis"}</span></div>
      </header>
      <TraceList trace={trace} />
    </section>
  );
}

function factCheckLabel(status: FactCheckStatus) {
  if (status === "supported") return "Supported";
  if (status === "contradicted") return "Contradicted";
  if (status === "context_needed") return "Needs context";
  return "Unresolved";
}

function savedAiTrace(analysis: Analysis): AnalysisTraceEvent[] {
  const ai = analysis.aiAnalysis;
  if (!ai) return [];
  const at = ai.analyzedAt;
  const providerName = aiProviderMeta[ai.provider || "codex"].label;
  return [
    { runId: analysis.id, id: "ai-analysis", kind: "runtime", status: "completed", title: `${providerName} analysis`, detail: "Research and analysis complete", at, durationMs: ai.runtimeMs },
    ...(ai.reasoningSummaries || []).map((detail, index): AnalysisTraceEvent => ({ runId: analysis.id, id: `saved-reasoning-${index}`, parentId: "ai-analysis", kind: "reasoning", status: "completed", title: "Reasoning summary", detail, at })),
    ...(ai.webSearchQueries || []).map((detail, index): AnalysisTraceEvent => ({ runId: analysis.id, id: `saved-search-${index}`, parentId: "ai-analysis", kind: "tool", status: "completed", title: "Web search", detail, at })),
    { runId: analysis.id, id: "agent-output", parentId: "ai-analysis", kind: "runtime", status: "completed", title: "Agent output", detail: ai.outputSummary || analysis.summary, at }
  ];
}

function AiDetailsDisclosure({ analysis, trace }: { analysis: Analysis; trace: AnalysisTraceEvent[] }) {
  const ai = analysis.aiAnalysis;
  const providerName = aiProviderMeta[ai?.provider || "codex"].label;
  const currentAiActivity = trace.filter((event) => event.id === "ai-analysis" || event.parentId === "ai-analysis");
  const activity = currentAiActivity.length ? currentAiActivity : savedAiTrace(analysis);
  if (!ai && !activity.length) return null;
  return (
    <details className="disclosure ai-details-disclosure">
      <summary>{providerName} analysis and research</summary>
      <div className="disclosure-body">
        {ai ? <p className="ai-output-summary">{ai.outputSummary || analysis.summary}</p> : <p className="helper">The AI run did not complete. The local fallback result is shown.</p>}
        {ai?.localModelSupport && <p className="model-support-note">Local model signals supported this {providerName} analysis. Every displayed cue was still checked against the source text.</p>}
        {activity.length > 0 && <div className="ai-activity"><h3>Agent activity</h3><TraceList trace={activity} /></div>}
      </div>
    </details>
  );
}

function analysisSectionsFor(analysis: Analysis): Array<{ id: AnalysisSection; label: string }> {
  return [
    { id: "overview", label: "Overview" },
    { id: "language", label: "Language" },
    { id: "voices", label: analysis.contentType === "article" ? "Perspectives" : "People & impacts" },
    { id: "evidence", label: "Evidence" }
  ];
}

function sourceContext(analysis: Analysis) {
  if (analysis.contentType === "bill") {
    return `${analysis.sourceName} is the analyzed legislative source. The page is identified as ${analysis.billNumber || "a bill"}, and outside research is kept separate from the bill text.`;
  }
  return `${analysis.sourceName} is the analyzed outlet or source. This page is classified as ${genreLabel(analysis.genre || "general").toLowerCase()}, and the analysis is grounded in the extracted article text.`;
}

function FindingList({ items, tone = "plain", emptyMessage = "No supported items were identified in the extracted source." }: { items: AnalysisFinding[]; tone?: "plain" | "included" | "question"; emptyMessage?: string }) {
  if (!items.length) return <p className="panel-empty">{emptyMessage}</p>;
  return (
    <ul className={`finding-list is-${tone}`}>
      {items.map((item, index) => (
        <li key={`${item.text}-${index}`}>
          {tone === "included" && <CheckCircle size={15} weight="fill" aria-hidden="true" />}
          {tone === "question" && <Question size={15} weight="bold" aria-hidden="true" />}
          <span>{item.text}</span>
        </li>
      ))}
    </ul>
  );
}

function OverviewPanel({ analysis }: { analysis: Analysis }) {
  const biasProfile = analysis.biasProfile || (analysis.backendBias ? biasProfileFromAssessment(analysis.backendBias) : {
    score: 0,
    level: "minimal" as const,
    summary: "No direct framing evidence was found in the extracted source."
  });
  const framing = analysis.contentType === "article" ? analysis.framingProfile.dominantFrames : [];
  return (
    <div className="analysis-panel overview-panel">
      <section className="prototype-section summary-block">
        <span className="prototype-label">Summary</span>
        <p>{analysis.summary}</p>
      </section>

      <section className="prototype-section bias-overview">
        <BiasProfileBand profile={biasProfile} />
        {analysis.backendBias ? <BiasSignalChart assessment={analysis.backendBias} /> : <p className="panel-empty">Bias dimensions could not be assessed from this extraction.</p>}
      </section>

      <section className="prototype-section main-framing">
        <span className="prototype-label">{analysis.contentType === "bill" ? "Main issue addressed" : "Main framing"}</span>
        <p>{analysis.mainIssue.text}</p>
        {framing.length > 0 && (
          <details className="inline-disclosure">
            <summary>Frame profile</summary>
            <div className="inline-disclosure-body"><FramingBars frames={framing} /></div>
          </details>
        )}
      </section>
    </div>
  );
}

type VocabularyItem = { term: string; meaning: string; context?: string };

const localDefinitions: Record<string, string> = {
  appropriation: "Money that a legislature authorizes for a particular public purpose.",
  authorization: "Legal permission for a program, agency, or activity to operate.",
  amendment: "A formal change proposed or made to a bill, law, or other document.",
  provision: "A specific rule or requirement inside a law, bill, contract, or policy.",
  mandate: "A requirement that a person, organization, or government body must follow.",
  subsidy: "Government financial support intended to lower costs or encourage an activity.",
  "tax credit": "An amount that directly reduces the tax someone owes.",
  "civil penalty": "A non-criminal fine or consequence for breaking a rule.",
  "reporting requirement": "A rule requiring an organization or agency to provide information on a schedule.",
  "effective date": "The date when a law or rule begins to apply."
};

function vocabularyItemsFor(analysis: Analysis): VocabularyItem[] {
  const items = new Map<string, VocabularyItem>();
  const evidenceById = new Map(analysis.evidence.map((item) => [item.id, item.supportingText]));
  for (const item of analysis.vocabularyTerms || []) {
    const context = item.evidenceIds.map((id) => evidenceById.get(id)).find(Boolean);
    items.set(item.term.toLowerCase(), { term: item.term, meaning: item.meaning, context });
  }
  if (analysis.contentType === "bill") {
    for (const item of analysis.importantTerms) {
      const context = item.evidenceIds.map((id) => evidenceById.get(id)).find(Boolean);
      items.set(item.term.toLowerCase(), { term: item.term, meaning: item.meaning, context });
    }
  }
  const searchable = `${analysis.summary} ${analysis.evidence.map((item) => item.supportingText).join(" ")}`.toLowerCase();
  for (const [term, meaning] of Object.entries(localDefinitions)) {
    if (!searchable.includes(term) || items.has(term)) continue;
    const context = analysis.evidence.find((item) => item.supportingText.toLowerCase().includes(term))?.supportingText;
    items.set(term, { term, meaning, context });
  }
  return Array.from(items.values()).slice(0, 8);
}

function VocabularySection({ analysis, onShowSource }: { analysis: Analysis; onShowSource: (text: string) => void }) {
  const terms = vocabularyItemsFor(analysis);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);

  useEffect(() => { setQuestion(""); setAnswer(null); }, [analysis.id]);

  function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = question.trim().replace(/[?.!,;:"']+$/g, "").toLowerCase();
    const match = terms.find((item) => query.includes(item.term.toLowerCase()) || item.term.toLowerCase().includes(query));
    setAnswer(match
      ? `${match.term}: ${match.meaning}`
      : `No saved definition matches “${question.trim()}”. Check how the source uses the term, who defines it, and whether its meaning changes across the article.`);
  }

  return (
    <section className="vocabulary-section" aria-labelledby="vocabulary-heading">
      <div className="vocabulary-heading">
        <div><BookOpenText size={16} /><h2 id="vocabulary-heading">Definitions</h2></div>
        <span>{terms.length ? `${terms.length} found` : "None found"}</span>
      </div>
      {terms.length > 0 ? (
        <dl className="vocabulary-list">
          {terms.map((item) => (
            <div key={item.term.toLowerCase()}>
              <dt>{item.term}</dt>
              <dd>{item.meaning}</dd>
              {item.context && <button className="source-highlight-button" type="button" onClick={() => onShowSource(item.context as string)}><LinkSimple size={12} />Show in article</button>}
            </div>
          ))}
        </dl>
      ) : <p className="panel-empty">No source-specific term needs a saved definition yet.</p>}
      <form className="vocabulary-question" onSubmit={ask}>
        <label htmlFor="vocabulary-question">Ask about a term in this source</label>
        <div><input id="vocabulary-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What does appropriation mean?" /><button className="secondary-button" type="submit" disabled={!question.trim()}>Ask</button></div>
        {answer && <p role="status">{answer}</p>}
      </form>
    </section>
  );
}

function LanguagePanel({ analysis, onShowSource }: { analysis: Analysis; onShowSource: (text: string) => void }) {
  const signals = analysis.backendBias?.linguistic_evidence.signals || [];
  const localExamples = analysis.contentType === "article" ? analysis.loadedLanguageExamples : [];
  return (
    <div className="analysis-panel language-panel">
      <p className="panel-intro">These exact passages may shape how the subject is read. They are prompts for context, not factuality ratings.</p>
      {signals.length > 0 ? (
        <ul className="language-list">
          {signals.map((signal) => (
            <li key={signal.id}>
              <mark>“{signal.phrase}”</mark>
              <p>{signal.explanation}</p>
              <blockquote>{signal.context}</blockquote>
              <button className="source-highlight-button" type="button" onClick={() => onShowSource(signal.context)}><LinkSimple size={12} />Show in article</button>
            </li>
          ))}
        </ul>
      ) : localExamples.length > 0 ? (
        <ul className="language-list">
          {localExamples.map((item) => (
            <li key={`${item.phrase}-${item.context}`}>
              <mark>“{item.phrase}”</mark>
              <p>{item.text}</p>
              <blockquote>{item.context}</blockquote>
              <button className="source-highlight-button" type="button" onClick={() => onShowSource(item.context)}><LinkSimple size={12} />Show in article</button>
            </li>
          ))}
        </ul>
      ) : <p className="panel-empty">No directly supported language cue was identified.</p>}
      <VocabularySection analysis={analysis} onShowSource={onShowSource} />
    </div>
  );
}

function sourceTypeLabel(source: ArticleSource) {
  if (source.entityType === "government") return "Government source";
  if (source.entityType === "media") return "News or reporting organization";
  if (source.entityType === "anonymous_source") return "Unnamed attributed source";
  if (source.entityType === "document") return "Report, study, or official document";
  if (source.entityType === "person") return "Named person";
  return "Organization";
}

function SourcesAndVoicesPanel({ analysis, onShowSource }: { analysis: Analysis; onShowSource: (text: string) => void }) {
  if (analysis.contentType === "bill") {
    return (
      <div className="analysis-panel sources-voices-panel">
        <section className="prototype-section"><span className="prototype-label">Groups that may be affected</span><FindingList items={analysis.affectedGroups} /></section>
        <section className="prototype-section"><span className="prototype-label">Sourced positions</span><FindingList items={[...analysis.sourcedSupporters, ...analysis.sourcedOpponents]} tone="included" /></section>
        <section className="prototype-section missing-block"><span className="prototype-label">Unclear impacts</span><FindingList items={analysis.unclearImpacts} tone="question" /></section>
      </div>
    );
  }
  const sources = analysis.sourcesAndVoices || [];
  return (
    <div className="analysis-panel sources-voices-panel">
      <section className="prototype-section">
        <span className="prototype-label">Explicitly attributed sources</span>
        {sources.length > 0 ? (
          <ul className="people-list source-voice-list">{sources.map((source) => (
            <li key={source.canonicalId}>
              <details className="source-voice-disclosure">
                <summary><strong>{source.displayName}</strong></summary>
                <div className="source-voice-details">
                  <span>{sourceTypeLabel(source)} · {sourceRoleLabel(source)}</span>
                  <p>{source.contributionSummary}</p>
                  {source.reportedVia?.[0] && <small>Reported through {source.reportedVia[0]}</small>}
                  {source.evidence[0] && (
                    <div className="source-voice-evidence">
                      <blockquote>{source.evidence[0].evidenceText}</blockquote>
                      <button className="source-highlight-button" type="button" onClick={() => onShowSource(source.evidence[0].evidenceText)}><LinkSimple size={12} />View in article</button>
                      {source.evidence.length > 1 && <details className="source-evidence-more"><summary>{source.evidence.length - 1} more attributed passage{source.evidence.length === 2 ? "" : "s"}</summary>{source.evidence.slice(1, 3).map((evidence, index) => <blockquote key={`${evidence.blockId}-${evidence.sentenceIndex}-${index}`}>{evidence.evidenceText}</blockquote>)}</details>}
                    </div>
                  )}
                </div>
              </details>
            </li>
          ))}</ul>
        ) : <p className="panel-empty">No clearly attributed sources were identified in this article.</p>}
        {analysis.sourceSummary && <p className="source-list-summary">{analysis.sourceSummary}</p>}
      </section>
    </div>
  );
}

function ResearchClaims({ analysis, onShowSource }: { analysis: Analysis; onShowSource: (text: string) => void }) {
  const checks = analysis.aiAnalysis?.factChecks || [];
  const sourceEvidence = analysis.evidence.filter((item) => item.kind === "source_text").slice(0, 6);
  if (!checks.length && !sourceEvidence.length) return <p className="panel-empty">No source-linked claims were available.</p>;
  return (
    <div className="claim-list">
      {checks.length > 0 ? checks.map((check) => (
        <details key={check.id}>
          <summary><span>{check.claim}</span><span className={`fact-status is-${check.status}`}>{factCheckLabel(check.status)}</span></summary>
          <div className="claim-body">
            <blockquote>{check.sourceText}</blockquote>
            <p>{check.explanation}</p>
            <button className="source-highlight-button" type="button" onClick={() => onShowSource(check.sourceText)}><LinkSimple size={12} />Show in article</button>
            <div className="fact-citations">
              {check.citations.map((citation) => <a href={citation.url} target="_blank" rel="noreferrer" key={citation.url}><LinkSimple size={12} />{citation.label}<span>{citation.evidence}</span></a>)}
            </div>
          </div>
        </details>
      )) : sourceEvidence.map((item) => (
        <details key={item.id}>
          <summary><span>{item.claim}</span></summary>
          <div className="claim-body"><blockquote>{item.supportingText}</blockquote><p>{item.explanation}</p><button className="source-highlight-button" type="button" onClick={() => onShowSource(item.supportingText)}><LinkSimple size={12} />Show in article</button></div>
        </details>
      ))}
    </div>
  );
}

function SourcesPanel({ analysis, trace, onShowSource }: { analysis: Analysis; trace: AnalysisTraceEvent[]; onShowSource: (text: string) => void }) {
  return (
    <div className="analysis-panel sources-panel">
      <section className="prototype-section">
        <span className="prototype-label">Outlet and source context</span>
        <p className="source-context-copy">{sourceContext(analysis)}</p>
        {/^(https?):\/\//.test(analysis.url) && <a className="source-context-link" href={analysis.url} target="_blank" rel="noreferrer"><LinkSimple size={14} />Open source</a>}
      </section>
      <section className="prototype-section">
        <div className="prototype-heading-row"><span className="prototype-label">Cited claims</span>{analysis.aiAnalysis && <span>{analysis.aiAnalysis.researchSourceCount || 0} research sources</span>}</div>
        <ResearchClaims analysis={analysis} onShowSource={onShowSource} />
      </section>
      <section className="prototype-section source-details">
        <AiDetailsDisclosure analysis={analysis} trace={trace} />
        {analysis.contentType === "bill" && <details className="disclosure"><summary>Bill details</summary><div className="disclosure-body"><SourceBreakdown analysis={analysis} /></div></details>}
        <details className="disclosure"><summary>All evidence ({analysis.evidence.length})</summary><div className="disclosure-body"><EvidenceList analysis={analysis} /></div></details>
        <FeedbackDisclosure analysis={analysis} />
      </section>
    </div>
  );
}

function AnalysisView({
  analysis,
  aiEnabled,
  aiConnection,
  canReanalyze,
  onNewAnalysis,
  onSaveAnalysis,
  onOpenAiSettings,
  onRetryAi,
  onShowSource,
  trace
}: {
  analysis: Analysis;
  aiEnabled: boolean;
  aiConnection: AiConnectionStatus | null;
  canReanalyze: boolean;
  onNewAnalysis: () => void;
  onSaveAnalysis: () => void;
  onOpenAiSettings: () => void;
  onRetryAi: () => void;
  onShowSource: (text: string) => void;
  trace: AnalysisTraceEvent[];
}) {
  const sourceIsLink = /^https?:\/\//.test(analysis.url);
  const analysisSections = analysisSectionsFor(analysis);
  const [section, setSection] = useState<AnalysisSection>("overview");
  useEffect(() => setSection("overview"), [analysis.id]);

  function moveAnalysisTab(event: React.KeyboardEvent<HTMLButtonElement>, current: AnalysisSection) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = analysisSections.findIndex((item) => item.id === current);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? analysisSections.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + analysisSections.length) % analysisSections.length;
    const next = analysisSections[nextIndex].id;
    setSection(next);
    requestAnimationFrame(() => document.getElementById(`analysis-tab-${next}`)?.focus());
  }

  return (
    <div className="result-stack prototype-result">
      <section className="source-reference">
        <div>
          <span>{analysis.sourceName}</span>
          <span>{contentLabel(analysis.contentType)}</span>
          {analysis.contentType === "article" && <span>{genreLabel(analysis.genre || "general")}</span>}
          <span>{analysis.aiAnalysis ? `${aiProviderMeta[analysis.aiAnalysis.provider || "codex"].label} assisted` : "Local analysis"}</span>
        </div>
        <p title={analysis.pageTitle}>{analysis.pageTitle}</p>
        <div className="source-actions">
          <button className="compact-action" type="button" onClick={onSaveAnalysis}><FloppyDisk size={14} />Save</button>
          <button className="compact-action" type="button" onClick={onNewAnalysis}>New</button>
          {sourceIsLink && <a className="compact-action" href={analysis.url} target="_blank" rel="noreferrer"><LinkSimple size={14} />Source</a>}
        </div>
        {aiEnabled && !analysis.aiAnalysis && (
          <div className="ai-result-status" role="status">
            <div>
              <WarningCircle size={16} />
              <span><strong>Local result shown</strong><small>{analysis.aiFailureReason || aiConnection?.providerMessage || "AI deep analysis did not complete."}</small></span>
            </div>
            <div>
              <button className="text-button" type="button" onClick={onOpenAiSettings}><GearSix size={14} /> Settings</button>
              {canReanalyze && <button className="text-button" type="button" onClick={onRetryAi}><ArrowClockwise size={14} /> Retry</button>}
            </div>
          </div>
        )}
      </section>
      <nav className="analysis-tabs" role="tablist" aria-label="Analysis sections">
        {analysisSections.map((item) => <button id={`analysis-tab-${item.id}`} key={item.id} type="button" role="tab" aria-selected={section === item.id} aria-controls={`analysis-panel-${item.id}`} tabIndex={section === item.id ? 0 : -1} className={section === item.id ? "is-active" : ""} onClick={() => setSection(item.id)} onKeyDown={(event) => moveAnalysisTab(event, item.id)}>{item.label}</button>)}
      </nav>
      <section id={`analysis-panel-${section}`} role="tabpanel" aria-labelledby={`analysis-tab-${section}`}>
        {section === "overview" && <OverviewPanel analysis={analysis} />}
        {section === "language" && <LanguagePanel analysis={analysis} onShowSource={onShowSource} />}
        {section === "voices" && <SourcesAndVoicesPanel analysis={analysis} onShowSource={onShowSource} />}
        {section === "evidence" && <SourcesPanel analysis={analysis} trace={trace} onShowSource={onShowSource} />}
      </section>
      <footer className="analysis-disclaimer">Ellipsis shows how this {analysis.contentType} is framed and which claims have supporting evidence. AI-assisted results may be incomplete.</footer>
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
      {analysis.sourcesAndVoices.length > 0 && <div className="detail-group"><h3>Sources and voices</h3><ul>{analysis.sourcesAndVoices.map((source) => <li key={source.canonicalId}><strong>{source.displayName}:</strong> {source.contributionSummary}</li>)}</ul></div>}
    </>
  );
}

function EvidenceList({ analysis }: { analysis: Analysis }) {
  const unique = new Map<string, Analysis["evidence"][number]>();
  for (const item of analysis.evidence) {
    const key = `${item.kind}:${item.supportingText.trim().toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  const items = Array.from(unique.values());
  const groups = [
    { kind: "source_text", title: "Source evidence", description: "Exact passages from the analyzed page." },
    { kind: "outside_context", title: "Outside context", description: "Cited web context retrieved separately. It is not used as a direct source-text bias cue." },
    { kind: "analysis_note", title: "Analysis notes", description: "Method and uncertainty notes created by Ellipsis." }
  ] as const;
  return (
    <div className="evidence-groups">
      {groups.map((group) => {
        const groupedItems = items.filter((item) => item.kind === group.kind);
        if (!groupedItems.length) return null;
        return (
          <section key={group.kind}>
            <header><h3>{group.title}</h3><p>{group.description}</p></header>
            <ul className="evidence-list">
              {groupedItems.map((item) => (
                <li key={item.id}>
                  <strong>{item.claim}</strong>
                  <blockquote>{item.supportingText}</blockquote>
                  <p>{item.explanation}</p>
                  {item.kind === "outside_context" && item.sourceUrl && (
                    <a className="evidence-source-link" href={item.sourceUrl} target="_blank" rel="noreferrer"><LinkSimple size={13} />Open context source</a>
                  )}
                  <span>{group.title} · {item.confidenceLabel} confidence</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
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

function PersistentAiControl({ enabled, connection, onToggle, onOpenSettings }: {
  enabled: boolean;
  connection: AiConnectionStatus | null;
  onToggle: (enabled: boolean) => void;
  onOpenSettings: () => void;
}) {
  const state = !enabled ? "off" : connection?.providerStatus === "ready" ? "ready" : "attention";
  return (
    <div className={`persistent-ai is-${state}`}>
      <label className="compact-switch" title="Use AI deep analysis">
        <Cpu size={15} />
        <span>AI</span>
        <input type="checkbox" role="switch" aria-label="Use AI deep analysis" checked={enabled} onChange={(event) => onToggle(event.target.checked)} />
        <i aria-hidden="true" />
      </label>
      <button className="topbar-icon-button" type="button" aria-label="Open AI settings" title="AI settings" onClick={onOpenSettings}><GearSix size={16} /></button>
    </div>
  );
}

function AiSettingsDialog({
  open,
  settings,
  connection,
  suggestEnabled,
  onClose,
  onConnect,
  onTest,
  onSave
}: {
  open: boolean;
  settings: AiSettings;
  connection: AiConnectionStatus | null;
  suggestEnabled: boolean;
  onClose: () => void;
  onConnect: (provider: AiProvider) => Promise<AiLoginResult>;
  onTest: (provider: AiProvider) => Promise<AiConnectionStatus>;
  onSave: (settings: AiSettings) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(settings);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [waitingForAuth, setWaitingForAuth] = useState(false);
  const [status, setStatus] = useState<AiConnectionStatus | null>(connection);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft({ ...settings, enabled: suggestEnabled || settings.enabled });
    setStatus(connection?.provider === settings.provider ? connection : null);
    setWaitingForAuth(false);
    setFormError(null);
  }, [open]);

  useEffect(() => {
    if (!open || !waitingForAuth) return;
    let checking = false;
    const interval = window.setInterval(async () => {
      if (checking) return;
      checking = true;
      const next = await onTest(draft.provider);
      setStatus(next);
      if (next.providerStatus === "ready") {
        setWaitingForAuth(false);
        const verified = { ...draft, enabled: true, connectionVerifiedAt: next.checkedAt };
        setDraft(verified);
        const saved = await onSave(verified);
        if (saved) onClose();
        else setFormError(`${aiProviderMeta[draft.provider].label} signed in, but Ellipsis could not enable AI deep analysis.`);
      }
      checking = false;
    }, 2_000);
    return () => window.clearInterval(interval);
  }, [open, waitingForAuth, draft.provider]);

  if (!open) return null;

  async function connectProvider() {
    setTesting(true);
    setFormError(null);
    try {
      const result = await onConnect(draft.provider);
      setStatus(result.status);
      if (result.status.providerStatus === "ready") {
        const verified = { ...draft, enabled: true, connectionVerifiedAt: result.status.checkedAt };
        setDraft(verified);
        const saved = await onSave(verified);
        if (saved) onClose();
        else setFormError(`${aiProviderMeta[draft.provider].label} connected, but Ellipsis could not enable AI deep analysis.`);
      } else if (result.authUrl || result.loginStarted) {
        if (result.authUrl) {
          if (typeof chrome !== "undefined" && chrome.tabs?.create) await chrome.tabs.create({ url: result.authUrl });
          else window.open(result.authUrl, "_blank", "noopener,noreferrer");
        }
        setWaitingForAuth(true);
      }
    } catch (error) {
      setFormError(error instanceof Error ? error.message : `${aiProviderMeta[draft.provider].label} connection failed.`);
    } finally {
      setTesting(false);
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    const saved = await onSave(draft);
    setSaving(false);
    if (saved) onClose();
    else setFormError(`Connect ${aiProviderMeta[draft.provider].label} before enabling AI deep analysis.`);
  }

  const providerMeta = aiProviderMeta[draft.provider];

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-settings-title">
        <header className="settings-header">
          <div><GearSix size={17} /><strong id="ai-settings-title">AI settings</strong></div>
          <button className="topbar-icon-button" type="button" aria-label="Close AI settings" onClick={onClose}><X size={17} /></button>
        </header>
        <form className="settings-form" onSubmit={saveSettings}>
          <fieldset className="mode-options">
            <legend>Analysis mode</legend>
            <label className={draft.enabled ? "is-selected" : ""}>
              <input type="radio" name="analysis-mode" checked={draft.enabled} onChange={() => setDraft((current) => ({ ...current, enabled: true }))} />
              <span><strong>AI deep analysis</strong><small>Research, cited claim checks, and deeper framing across the complete result.</small></span>
            </label>
            <label className={!draft.enabled ? "is-selected" : ""}>
              <input type="radio" name="analysis-mode" checked={!draft.enabled} onChange={() => setDraft((current) => ({ ...current, enabled: false }))} />
              <span><strong>Local analysis only</strong><small>Summaries and evidence checks work without an AI provider.</small></span>
            </label>
          </fieldset>

          {draft.enabled && (
            <div className="connection-settings">
              <div className="field">
                <label htmlFor="ai-provider">Provider</label>
                <select
                  id="ai-provider"
                  value={draft.provider}
                  onChange={(event) => {
                    const provider = event.target.value as AiProvider;
                    setDraft((current) => ({ ...current, provider, connectionVerifiedAt: null }));
                    setStatus(connection?.provider === provider ? connection : null);
                    setWaitingForAuth(false);
                    setFormError(null);
                  }}
                >
                  <option value="codex">Codex</option>
                  <option value="claude">Claude Code</option>
                </select>
              </div>
              <div className="managed-note"><Cpu size={17} /><span><strong>Native {providerMeta.label} connection</strong><small>Chrome launches the installed Ellipsis connector and your local {providerMeta.label} runtime when needed. There is no server command, port, hosted proxy, or extension API key.</small></span></div>
              <dl className="runtime-settings">
                <div><dt>Model</dt><dd>{providerMeta.model}</dd></div>
                <div><dt>Reasoning</dt><dd>{providerMeta.reasoning}</dd></div>
                <div><dt>Activity</dt><dd>Summarized reasoning and tool calls</dd></div>
                <div><dt>Tools</dt><dd>{providerMeta.tools}</dd></div>
                <div><dt>Local support</dt><dd>Optional evidence-linked Python models</dd></div>
                <div><dt>Connection</dt><dd>Chrome Native Messaging</dd></div>
                <div><dt>Data scope</dt><dd>Source text and cited web context</dd></div>
              </dl>
              <div className="connection-test">
                <button className="secondary-button" type="button" onClick={() => void connectProvider()} disabled={testing || waitingForAuth}>{testing ? "Connecting..." : waitingForAuth ? "Waiting for sign in" : status?.providerStatus === "ready" ? "Check again" : `Connect ${providerMeta.label}`}</button>
                <p className={status?.providerStatus === "ready" ? "is-ready" : ""}>{waitingForAuth ? "Finish signing in in the opened browser. Ellipsis will detect the connection automatically." : status?.providerMessage || `Press Connect ${providerMeta.label}. Ellipsis starts the local runtime and enables AI when the connection succeeds.`}</p>
              </div>
              {status?.providerStatus === "unavailable" && <p className="connection-help">The Ellipsis AI Connector is missing or could not start. Install the connector package once, reopen Chrome, and try again.</p>}
              <div className="data-boundary"><ShieldCheck size={17} /><p>When AI is on, the connector sends the extracted source to {providerMeta.label}. It usually runs one to three focused searches to check material claims; cited research stays separate from source evidence. Local analysis remains available if AI fails.</p></div>
            </div>
          )}

          {formError && <div className="settings-error" role="alert"><WarningCircle size={16} /><span>{formError}</span></div>}
          <footer className="settings-footer">
            <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
            <button className="primary-button" type="submit" disabled={saving || (draft.enabled && status?.providerStatus !== "ready")}>{saving ? "Saving..." : draft.enabled ? "Save and use AI" : "Use local analysis"}</button>
          </footer>
        </form>
      </section>
    </div>
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

    </section>
  );
}

export default function App() {
  const [activeView, setActiveView] = useState<AppView>("analysis");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [saved, setSaved] = useState<SavedAnalysis[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [aiSettings, setAiSettings] = useState<AiSettings>({ enabled: false, provider: "codex", connectionVerifiedAt: null });
  const [aiConnection, setAiConnection] = useState<AiConnectionStatus | null>(null);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [suggestAiEnabled, setSuggestAiEnabled] = useState(false);
  const [sourcePage, setSourcePage] = useState<ExtractedPage | null>(null);
  const [analysisTrace, setAnalysisTrace] = useState<AnalysisTraceEvent[]>([]);
  const activeTraceId = useRef<string | null>(null);
  const analysisInFlight = useRef(false);

  function updateTrace(event: AnalysisTraceEvent) {
    if (event.runId && activeTraceId.current !== event.runId) return;
    setAnalysisTrace((current) => {
      const index = current.findIndex((item) => item.id === event.id);
      if (index < 0) return [...current, { ...event, startedAt: event.startedAt || (event.status === "running" ? event.at : undefined) }];
      const next = [...current];
      next[index] = {
        ...next[index],
        ...event,
        startedAt: next[index].startedAt || event.startedAt || (event.status === "running" ? event.at : undefined)
      };
      return next;
    });
  }

  useEffect(() => subscribeAiProgress(updateTrace), []);

  useEffect(() => { getSavedAnalyses().then(setSaved).catch(() => setError("Saved history could not be loaded.")); }, []);
  useEffect(() => {
    getAiSettings().then((settings) => {
      setAiSettings(settings);
      if (settings.enabled) void refreshAiConnection(settings.provider);
    }).catch(() => undefined);
  }, []);

  async function refreshAiConnection(provider = aiSettings.provider): Promise<AiConnectionStatus> {
    let status: AiConnectionStatus;
    try {
      status = await checkAiConnection(provider);
    } catch (error) {
      status = unavailableAiStatus(provider, error instanceof Error ? error.message : "Ellipsis AI Connector is unavailable.");
    }
    setAiConnection(status);
    return status;
  }

  async function connectAi(provider: AiProvider): Promise<AiLoginResult> {
    try {
      const result = await beginAiLogin(provider);
      setAiConnection(result.status);
      return result;
    } catch (error) {
      const status = unavailableAiStatus(provider, error instanceof Error ? error.message : "Ellipsis AI Connector is unavailable.");
      setAiConnection(status);
      return { status };
    }
  }

  function openAiSettings(suggestEnabled = false) {
    setSuggestAiEnabled(suggestEnabled);
    setAiSettingsOpen(true);
  }

  async function analyzeExtractedPage(page: ExtractedPage, settings = aiSettings) {
    const traceId = `analysis_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    activeTraceId.current = traceId;
    setAnalysisTrace([
      { runId: traceId, id: "gather-source", kind: "local", status: "pending", title: "Gather source text", at: new Date().toISOString() },
      ...(settings.enabled ? [
        { runId: traceId, id: "local-model-support", kind: "local" as const, status: "pending" as const, title: "Local model support", at: new Date().toISOString() },
        { runId: traceId, id: "ai-analysis", kind: "runtime" as const, status: "pending" as const, title: `${aiProviderMeta[settings.provider].label} analysis`, at: new Date().toISOString() }
      ] : [])
    ]);
    setError(null);
    setNotice(null);
    try {
      if (page.text.trim().length < 120) throw new Error("The readable text was too short. Try the link option or paste the source text.");
      const next = await analyzePageWithBackend(page, { aiSettings: settings, traceId, onProgress: updateTrace });
      setAnalysis(next);
      if (settings.enabled && !next.aiAnalysis) setNotice("AI deep analysis did not complete. The full local result is shown, and AI settings remain available above.");
      setActiveView("analysis");
    } catch (event) {
      setError(event instanceof Error ? event.message : "Analysis failed.");
    } finally {
      activeTraceId.current = null;
    }
  }

  async function analyze(pagePromise: Promise<ReturnType<typeof createManualPage>>, settings = aiSettings) {
    if (analysisInFlight.current) return;
    analysisInFlight.current = true;
    setLoading(true);
    try {
      const page = await pagePromise;
      setSourcePage(page);
      await analyzeExtractedPage(page, settings);
    } catch (event) {
      setError(event instanceof Error ? event.message : "Analysis failed.");
    } finally {
      analysisInFlight.current = false;
      setLoading(false);
    }
  }

  async function applyAiSettings(next: AiSettings, verifiedStatus?: AiConnectionStatus) {
    let settings = { ...next };
    if (settings.enabled) {
      const status = verifiedStatus?.providerStatus === "ready" && verifiedStatus.provider === settings.provider ? verifiedStatus : await refreshAiConnection(settings.provider);
      if (status.providerStatus !== "ready") return false;
      settings = { ...settings, connectionVerifiedAt: status.checkedAt };
    }
    setAiSettings(settings);
    await saveAiSettings(settings);
    setNotice(settings.enabled ? "AI deep analysis is on." : "Local analysis mode is on.");
    if (sourcePage) await analyze(Promise.resolve(sourcePage), settings);
    return true;
  }

  function toggleAi(enabled: boolean) {
    if (!enabled) {
      void applyAiSettings({ ...aiSettings, enabled: false });
      return;
    }
    void (async () => {
      const status = aiConnection?.providerStatus === "ready" && aiConnection.provider === aiSettings.provider ? aiConnection : await refreshAiConnection(aiSettings.provider);
      if (status.providerStatus === "ready") {
        await applyAiSettings({ ...aiSettings, enabled: true, connectionVerifiedAt: status.checkedAt }, status);
      } else {
        openAiSettings(true);
      }
    })();
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

  async function showSourcePassage(text: string) {
    const highlighted = await highlightActivePagePassage(text);
    setNotice(highlighted
      ? "The matching passage is highlighted in the article."
      : "Ellipsis could not match that passage on the active page. The cited text remains available here.");
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <span className="brand-lockup">
          <img className="brand-icon" src="/icons/ellipsis-32.png" alt="" aria-hidden="true" />
          <span className="brand-name">Ellipsis</span>
        </span>
        <div className="topbar-actions">
          {analysis && activeView === "analysis" && <span className={`confidence-badge is-${confidenceLabel(analysis.confidenceScore).toLowerCase()}`}>{confidenceLabel(analysis.confidenceScore)} confidence</span>}
          <PersistentAiControl enabled={aiSettings.enabled} connection={aiConnection} onToggle={toggleAi} onOpenSettings={() => openAiSettings(false)} />
          <button className={`topbar-icon-button history-button ${activeView === "saved" ? "is-active" : ""}`} type="button" aria-label={activeView === "saved" ? "Return to analysis" : "Open saved analyses"} title={activeView === "saved" ? "Return to analysis" : "Saved analyses"} onClick={() => { setActiveView((current) => current === "saved" ? "analysis" : "saved"); setNotice(null); }}><ClockCounterClockwise size={17} /></button>
          <button className="primary-button" type="button" onClick={runPageAnalysis} disabled={loading}><MagnifyingGlass size={15} /> Analyze</button>
        </div>
      </header>
      <div className="content">
        {error && activeView === "analysis" && <div className="error-panel" role="alert"><strong><WarningCircle size={16} /> Issue</strong><p>{error}</p></div>}
        {notice && <div className="notice-panel" role="status">{notice}</div>}
        {loading ? <LoadingState aiEnabled={aiSettings.enabled} trace={analysisTrace} /> : (
          <section>
            {activeView === "analysis" && (analysis
              ? <AnalysisView analysis={analysis} aiEnabled={aiSettings.enabled} aiConnection={aiConnection} canReanalyze={Boolean(sourcePage)} onSaveAnalysis={saveCurrentAnalysis} onOpenAiSettings={() => openAiSettings(false)} onRetryAi={() => { if (sourcePage) void analyze(Promise.resolve(sourcePage)); }} onShowSource={(text) => { void showSourcePassage(text); }} onNewAnalysis={() => { setAnalysis(null); setSourcePage(null); setAnalysisTrace([]); setError(null); setNotice(null); }} trace={analysisTrace} />
              : <StartView loading={loading} onAnalyzePage={runPageAnalysis} onAnalyzeUrl={runUrlAnalysis} onAnalyzeText={runManualAnalysis} />)}
            {activeView === "saved" && <HistoryView saved={saved} onOpen={(next) => { setAnalysis(next); setSourcePage(null); setAnalysisTrace([]); setActiveView("analysis"); }} onDelete={removeSaved} onClear={clearHistory} />}
          </section>
        )}
      </div>
      <AiSettingsDialog open={aiSettingsOpen} settings={aiSettings} connection={aiConnection} suggestEnabled={suggestAiEnabled} onClose={() => { setAiSettingsOpen(false); setSuggestAiEnabled(false); }} onConnect={connectAi} onTest={refreshAiConnection} onSave={applyAiSettings} />
    </main>
  );
}
