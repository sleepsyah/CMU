import {
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
import { analyzePageWithBackend } from "../lib/backend";
import { createManualPage, extractActivePage } from "../lib/chrome";
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
  BiasDimension,
  BiasMetric,
  BillAnalysis,
  ContentType,
  FeedbackType,
  SavedAnalysis
} from "../types";

type Tab = "analysis" | "saved" | "details";

const feedbackTypes: FeedbackType[] = ["Helpful", "Confusing", "Incorrect", "Biased"];

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
  const findings: Array<{ text: string; context?: string }> = [];
  const seenDimensions = new Set<BiasDimension>();
  for (const signal of analysis.backendBias?.linguistic_evidence.signals || []) {
    if (seenDimensions.has(signal.dimension)) continue;
    seenDimensions.add(signal.dimension);
    findings.push({
      text: signal.dimension === "political"
        ? `Political wording cue: “${signal.phrase}” may add emotional or evaluative force.`
        : `${dimensionTitle(signal.dimension)} cue: “${signal.phrase}” is directly associated with a group reference.`,
      context: signal.context
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

function MetricRow({ title, metric }: { title: string; metric: BiasMetric }) {
  const assessed = metric.status === "assessed" && metric.score !== null;
  const score = assessed ? Math.round(metric.score as number) : null;
  const strength = score === null ? "No direct cues found" : score < 34 ? "Low detected signal" : score < 67 ? "Moderate detected signal" : "High detected signal";
  const evidenceLabel = metric.evidenceCount === 1 ? "1 cited passage" : `${metric.evidenceCount} cited passages`;
  const tone = score === null ? "neutral" : score < 34 ? "low" : score < 67 ? "moderate" : "high";

  return (
    <div className="metric-row">
      <div>
        <span className="metric-name">{title}</span>
        <span className={`metric-detail is-${tone}`}>{strength}{score === null ? "" : ` · ${evidenceLabel}`}</span>
      </div>
      <span className={`metric-score is-${tone}`}>{score === null ? "Not assessed" : `${score} / 100`}</span>
    </div>
  );
}

function BiasSummary({ assessment }: { assessment?: BackendBiasAnalysis }) {
  if (!assessment) return null;
  return (
    <section className="surface result-section">
      <div className="section-heading">
        <h2>Bias signals</h2>
        <p>Direct wording cues by category. These scores do not rate factual accuracy.</p>
      </div>
      <div className="metric-list">
        <MetricRow title="Political" metric={assessment.scores.political_bias} />
        <MetricRow title="Gender" metric={assessment.scores.gender_bias} />
        <MetricRow title="Ethnicity" metric={assessment.scores.ethnicity_bias} />
      </div>
    </section>
  );
}

function AnalysisView({ analysis, onNewAnalysis, onSaveAnalysis }: { analysis: Analysis; onNewAnalysis: () => void; onSaveAnalysis: () => void }) {
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
        <p className="summary">{analysis.summary}</p>
        <div className="source-actions">
          <button className="primary-button" type="button" onClick={onSaveAnalysis}><FloppyDisk size={16} /> Save</button>
          <button className="secondary-button" type="button" onClick={onNewAnalysis}>New</button>
          {sourceIsLink && <a className="text-link" href={analysis.url} target="_blank" rel="noreferrer"><LinkSimple size={15} /> Source</a>}
        </div>
      </section>

      <BiasSummary assessment={analysis.backendBias} />

      <section className="surface result-section">
        <div className="section-heading">
          <h2>What to notice</h2>
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
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="helper">No strong local signal was detected. This is not a neutrality rating.</p>
        )}
      </section>

      <p className="result-note">Open Details for full evidence, confidence, and parser notes.</p>
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

function DetailsView({ analysis }: { analysis: Analysis | null }) {
  if (!analysis) return <section className="surface empty-state"><Info size={22} /><p>Analyze a source to inspect evidence and method details.</p></section>;
  const signals = analysis.backendBias?.linguistic_evidence.signals || [];
  return (
    <section className="surface details-view">
      <div className="details-intro">
        <h1>Analysis details</h1>
        <p>{analysis.confidenceReason}</p>
        <dl>
          <div><dt>Overall confidence</dt><dd>{analysis.confidenceScore}%</dd></div>
          <div><dt>Analysis mode</dt><dd>{analysis.backendBias?.source === "hybrid-backend" ? "Local model + heuristics" : "On-device heuristics"}</dd></div>
          <div><dt>Saved text</dt><dd>Only excerpts in a saved result</dd></div>
        </dl>
      </div>

      <details className="disclosure" open>
        <summary>Bias signal evidence ({signals.length})</summary>
        <div className="disclosure-body">
          {signals.length ? (
            <ul className="signal-list">
              {signals.map((signal) => (
                <li key={signal.id}>
                  <strong>{dimensionTitle(signal.dimension)}: “{signal.phrase}”</strong>
                  <blockquote>{signal.context}</blockquote>
                  <p>{signal.explanation}</p>
                  {signal.neutralAlternative && <p><strong>Check:</strong> {signal.neutralAlternative}</p>}
                </li>
              ))}
            </ul>
          ) : <p className="helper">No direct wording or stereotype association met the local evidence threshold.</p>}
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

  useEffect(() => { getSavedAnalyses().then(setSaved).catch(() => setError("Saved history could not be loaded.")); }, []);

  async function analyze(pagePromise: Promise<ReturnType<typeof createManualPage>>) {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const page = await pagePromise;
      if (page.text.trim().length < 120) throw new Error("The readable text was too short. Try the link option or paste the source text.");
      setAnalysis(await analyzePageWithBackend(page));
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
    { id: "analysis", label: analysis ? "Result" : "Analyze", icon: <FileText size={15} /> },
    { id: "saved", label: "Saved", icon: <ClockCounterClockwise size={15} /> },
    { id: "details", label: "Details", icon: <Info size={15} /> }
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
              ? <AnalysisView analysis={analysis} onSaveAnalysis={saveCurrentAnalysis} onNewAnalysis={() => { setAnalysis(null); setError(null); setNotice(null); }} />
              : <StartView loading={loading} onAnalyzePage={runPageAnalysis} onAnalyzeUrl={runUrlAnalysis} onAnalyzeText={runManualAnalysis} />)}
            {activeTab === "saved" && <HistoryView saved={saved} onOpen={(next) => { setAnalysis(next); setActiveTab("analysis"); }} onDelete={removeSaved} onClear={clearHistory} />}
            {activeTab === "details" && <DetailsView analysis={analysis} />}
          </section>
        )}
      </div>
    </main>
  );
}
