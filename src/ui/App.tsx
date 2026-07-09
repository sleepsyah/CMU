import {
  Archive,
  ClockCounterClockwise,
  FileText,
  FloppyDisk,
  SealWarning,
  Sparkle,
  Trash,
  WarningCircle
} from "@phosphor-icons/react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { analyzePage, classifyPastedText, confidenceLabel } from "../lib/analysis";
import { createManualPage, extractActivePage } from "../lib/chrome";
import { clearFeedbackLogs, clearSavedAnalyses, deleteSavedAnalysis, getSavedAnalyses, logFeedback, saveAnalysis } from "../lib/storage";
import type { Analysis, AnalysisFinding, BillAnalysis, ContentType, FeedbackType, SavedAnalysis } from "../types";

type Tab = "analysis" | "evidence" | "history" | "feedback";

const feedbackTypes: FeedbackType[] = ["Helpful", "Confusing", "Incorrect", "Biased"];

function confidenceClass(score: number) {
  if (score >= 75) return "good";
  if (score >= 50) return "warn";
  return "bad";
}

function contentLabel(type: ContentType) {
  if (type === "bill") return "Congress.gov bill";
  if (type === "article") return "News article";
  if (type === "unsupported") return "Unsupported";
  return "Unknown";
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

function FindingMeta({ finding }: { finding: AnalysisFinding }) {
  return (
    <div className="finding-meta">
      <span className={`badge ${confidenceClass(finding.confidenceScore)}`}>{finding.confidenceLabel} confidence</span>
      <span>{finding.evidenceIds.length} {finding.evidenceIds.length === 1 ? "evidence item" : "evidence items"}</span>
    </div>
  );
}

function FindingList({ title, items, emptyMessage }: { title: string; items: AnalysisFinding[]; emptyMessage: string }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">{title}</h2>
      </div>
      <div className="panel-body">
        {items.length ? (
          <ul className="section-list">
            {items.map((item, index) => (
              <li className={`section-item ${item.confidenceLabel === "Low" ? "is-low-confidence" : ""}`} key={`${item.text}-${index}`}>
                <p className="item-copy">{item.text}</p>
                <FindingMeta finding={item} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="helper">{emptyMessage}</p>
        )}
      </div>
    </section>
  );
}

function LoadingState() {
  return (
    <section className="panel">
      <div className="loading-state" aria-live="polite">
        <div className="skeleton wide" />
        <div className="skeleton medium" />
        <div className="skeleton short" />
        <p className="helper">Reading the active page and checking evidence.</p>
      </div>
    </section>
  );
}

function AnalysisView({ analysis, onNewAnalysis, onSaveAnalysis }: { analysis: Analysis; onNewAnalysis: () => void; onSaveAnalysis: () => void }) {
  const isLowConfidence = analysis.confidenceScore < 50;
  const isBill = analysis.contentType === "bill";
  const sourceIsLink = /^https?:\/\//.test(analysis.url);

  return (
    <>
      {isLowConfidence && (
        <div className="warning-panel" role="status">
          <strong>Low-confidence analysis</strong>
          <p className="item-copy">Some findings rely on incomplete extraction or parser observations. Review each finding’s evidence before relying on it.</p>
        </div>
      )}

      <section className="panel">
        <div className="panel-header">
          <div className="result-head">
            <h1 className="page-title">{analysis.pageTitle}</h1>
            <div className="meta-line">
              <span>{analysis.sourceName}</span>
              {analysis.author && <span>By {analysis.author}</span>}
              {analysis.publishedAt && <span>Published {formatDate(analysis.publishedAt)}</span>}
              <span>{contentLabel(analysis.contentType)}</span>
              <span>Analyzed {formatDate(analysis.createdAt)}</span>
            </div>
          </div>
          <span className={`badge ${confidenceClass(analysis.confidenceScore)}`} title={`${analysis.confidenceScore}% confidence`}>
            {confidenceLabel(analysis.confidenceScore)} · {analysis.confidenceScore}%
          </span>
        </div>
        <div className="panel-body">
          <p className="summary">{analysis.summary}</p>
          <div className="finding-meta">
            <span>{analysis.summaryEvidenceIds.length} summary evidence {analysis.summaryEvidenceIds.length === 1 ? "item" : "items"}</span>
            {sourceIsLink && <a href={analysis.url} target="_blank" rel="noreferrer">Open source</a>}
          </div>
          <p className="helper">{analysis.confidenceReason}</p>
        </div>
        <div className="panel-footer">
          <button className="secondary-button" type="button" onClick={onSaveAnalysis}>
            <FloppyDisk size={16} /> Save locally
          </button>
          <button className="secondary-button" type="button" onClick={onNewAnalysis}>New analysis</button>
        </div>
      </section>

      {isBill ? <BillDetails analysis={analysis as BillAnalysis} /> : <ArticleDetails analysis={analysis} />}
    </>
  );
}

function ArticleDetails({ analysis }: { analysis: Extract<Analysis, { contentType: "article" }> }) {
  return (
    <>
      <FindingList title="Main Issue" items={[analysis.mainIssue]} emptyMessage="The main issue was not clear." />
      <FindingList title="Possible Framing" items={analysis.framingNotes} emptyMessage="No framing prompts were generated." />
      <section className="panel">
        <div className="panel-header"><h2 className="panel-title">Potentially Loaded Language</h2></div>
        <div className="panel-body">
          {analysis.loadedLanguageExamples.length ? (
            <ul className="section-list">
              {analysis.loadedLanguageExamples.map((item) => (
                <li className="section-item" key={`${item.phrase}-${item.context}`}>
                  <span className="item-title">{item.phrase}</span>
                  <p className="quote">{item.context}</p>
                  <p className="helper">A flagged word is not automatically biased or inaccurate.</p>
                  <FindingMeta finding={item} />
                </li>
              ))}
            </ul>
          ) : <p className="helper">No terms from the limited local review list were detected. This is not a neutrality rating.</p>}
        </div>
      </section>
      <div className="two-column">
        <FindingList title="Included Perspectives" items={analysis.includedPerspectives} emptyMessage="No perspectives were reliably detected." />
        <FindingList title="Perspectives to Check" items={analysis.missingPerspectives} emptyMessage="No additional review prompts were generated." />
      </div>
      <FindingList title="Quoted or Attributed Sources" items={analysis.quotedPeopleOrGroups} emptyMessage="No named attributed sources were reliably detected." />
    </>
  );
}

function BillDetails({ analysis }: { analysis: BillAnalysis }) {
  return (
    <>
      <section className="panel">
        <div className="panel-header"><div><h2 className="panel-title">{analysis.billNumber}</h2><p className="panel-description">{analysis.billTitle}</p></div></div>
        <div className="panel-body"><p className="summary">{analysis.plainLanguageSummary}</p></div>
      </section>
      <FindingList title="Main Issue" items={[analysis.mainIssue]} emptyMessage="The main issue was not clear." />
      <FindingList title="What It Would Change" items={analysis.proposedChanges} emptyMessage="No clear legislative change was detected in the extracted text." />
      <div className="two-column">
        <FindingList title="Potentially Affected Groups" items={analysis.affectedGroups} emptyMessage="No groups were reliably connected to a legislative action." />
        <FindingList title="Unclear Impacts" items={analysis.unclearImpacts} emptyMessage="No impact caveats were generated." />
      </div>
      <div className="two-column">
        <FindingList title="Sourced Supporters" items={analysis.sourcedSupporters} emptyMessage="No named supporters were directly attributed in the extracted text." />
        <FindingList title="Sourced Opponents" items={analysis.sourcedOpponents} emptyMessage="No named opponents were directly attributed in the extracted text." />
      </div>
      <section className="panel">
        <div className="panel-header"><h2 className="panel-title">Important Terms</h2></div>
        <div className="panel-body">
          {analysis.importantTerms.length ? (
            <ul className="section-list">
              {analysis.importantTerms.map((item) => (
                <li className="section-item" key={item.term}>
                  <span className="item-title">{item.term}</span>
                  <p className="item-copy">{item.meaning}</p>
                  <FindingMeta finding={item} />
                </li>
              ))}
            </ul>
          ) : <p className="helper">No terms from the sourced legislative glossary were detected.</p>}
        </div>
      </section>
    </>
  );
}

function EvidenceView({ analysis }: { analysis: Analysis | null }) {
  if (!analysis) {
    return <section className="panel"><div className="empty-state"><Archive size={24} /><p>No evidence yet. Analyze a page to see source passages, outside context, and analysis notes.</p></div></section>;
  }
  return (
    <section className="panel">
      <div className="panel-header"><div><h2 className="panel-title">Evidence</h2><p className="panel-description">Source text, outside context, and parser notes are labeled separately.</p></div></div>
      <div className="panel-body">
        {analysis.evidence.length ? (
          <ul className="evidence-list">
            {analysis.evidence.map((item) => (
              <li className={`evidence-item ${item.confidenceLabel === "Low" ? "is-low-confidence" : ""}`} key={item.id}>
                <span className="item-title">{item.claim}</span>
                <p className="quote">{item.supportingText}</p>
                <p className="item-copy">{item.explanation}</p>
                <div className="finding-meta">
                  <span className={`badge ${confidenceClass(item.confidenceScore)}`}>{item.confidenceLabel} confidence</span>
                  <span>{item.kind === "source_text" ? "Source text" : item.kind === "outside_context" ? "Outside context" : "Analysis note"}</span>
                  {item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noreferrer">{item.sourceLabel}</a> : <span>{item.sourceLabel}</span>}
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="helper">No evidence-backed findings were generated.</p>}
      </div>
    </section>
  );
}

function HistoryView({ saved, onOpen, onDelete, onClear }: { saved: SavedAnalysis[]; onOpen: (analysis: Analysis) => void; onDelete: (id: string) => void; onClear: () => void }) {
  if (!saved.length) {
    return <section className="panel"><div className="empty-state"><ClockCounterClockwise size={24} /><p>No saved analyses yet. Saved items stay on this device and the list is capped at 50.</p></div></section>;
  }
  return (
    <section className="panel">
      <div className="panel-header"><div><h2 className="panel-title">Saved History</h2><p className="panel-description">{saved.length} of 50 saved locally.</p></div><button className="secondary-button" type="button" onClick={onClear}>Clear all</button></div>
      <div className="panel-body">
        <ul className="history-list">
          {saved.map((item) => (
            <li className="history-item" key={item.id}>
              <span className="item-title">{item.pageTitle}</span>
              <p className="item-copy">{item.summary}</p>
              <div className="meta-line"><span>{contentLabel(item.contentType)}</span><span>{formatDate(item.createdAt)}</span><span>{confidenceLabel(item.confidenceScore)} · {item.confidenceScore}%</span></div>
              <div className="actions">
                <button className="secondary-button" type="button" onClick={() => onOpen(item.analysis)}>Open</button>
                <button className="secondary-button" type="button" onClick={() => onDelete(item.id)}><Trash size={16} /> Delete</button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function FeedbackView({ analysis }: { analysis: Analysis | null }) {
  const [selected, setSelected] = useState<FeedbackType | null>(null);
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => { setSelected(null); setComment(""); setStatus(null); }, [analysis?.id]);

  async function submitFeedback() {
    if (!analysis || !selected) return;
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
      setStatus("Feedback saved locally on this device.");
      setComment("");
    } catch {
      setStatus("Feedback could not be saved. Check extension storage and try again.");
    }
  }

  async function clearFeedback() {
    if (!window.confirm("Delete all feedback saved on this device?")) return;
    try { await clearFeedbackLogs(); setStatus("Local feedback cleared."); setSelected(null); setComment(""); }
    catch { setStatus("Local feedback could not be cleared."); }
  }

  if (!analysis) return <section className="panel"><div className="empty-state"><SealWarning size={24} /><p>Analyze a page before submitting anonymous feedback.</p></div></section>;

  return (
    <section className="panel">
      <div className="panel-header"><div><h2 className="panel-title">Anonymous Feedback</h2><p className="panel-description">Stored only on this device in the current MVP. Nothing is submitted to the team.</p></div></div>
      <div className="panel-body">
        {status && <div className="notice-panel" role="status">{status}</div>}
        <div className="feedback-grid">
          {feedbackTypes.map((type) => (
            <button className={`choice-button ${selected === type ? "is-selected" : ""}`} type="button" aria-pressed={selected === type} key={type} onClick={() => { setSelected(type); setStatus(null); }}>{type}</button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="feedback-comment">Optional comment</label>
          <textarea id="feedback-comment" maxLength={1000} value={comment} onChange={(event) => setComment(event.target.value)} />
          <p className="helper">Do not include personal information. {comment.length}/1000</p>
        </div>
      </div>
      <div className="panel-footer">
        <button className="primary-button" type="button" disabled={!selected} onClick={submitFeedback}>Save feedback locally</button>
        <button className="secondary-button" type="button" onClick={clearFeedback}>Clear local feedback</button>
      </div>
    </section>
  );
}

function ManualFallback({ onAnalyze }: { onAnalyze: (text: string, type: ContentType, metadata: { title?: string; url?: string; sourceName?: string }) => void }) {
  const [text, setText] = useState("");
  const [type, setType] = useState<ContentType>("unknown");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [sourceName, setSourceName] = useState("");
  const inferredType = useMemo(() => classifyPastedText(text, url), [text, url]);
  const validUrl = !url.trim() || /^https?:\/\//i.test(url.trim());
  const canAnalyze = text.trim().length >= 120 && validUrl;

  function submitManualAnalysis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canAnalyze) onAnalyze(text, type === "unknown" ? inferredType : type, { title, url, sourceName });
  }

  return (
    <>
      <form className="panel" onSubmit={submitManualAnalysis}>
        <div className="panel-header"><div><h1 className="panel-title">Manual Paste</h1><p className="panel-description">Use this when page extraction is unavailable.</p></div></div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field"><label htmlFor="content-type">Content type</label><select id="content-type" value={type} onChange={(event) => setType(event.target.value as ContentType)}><option value="unknown">Detect from text</option><option value="article">News article</option><option value="bill">Congress.gov bill</option></select><p className="helper">Current guess: {contentLabel(inferredType)}.</p></div>
            <div className="field"><label htmlFor="manual-title">Source title <span className="optional">optional</span></label><input id="manual-title" value={title} onChange={(event) => setTitle(event.target.value)} /></div>
            <div className="field"><label htmlFor="manual-source">Source or outlet <span className="optional">optional</span></label><input id="manual-source" value={sourceName} onChange={(event) => setSourceName(event.target.value)} /></div>
            <div className="field"><label htmlFor="manual-url">Source URL <span className="optional">optional; does not fetch text</span></label><input id="manual-url" inputMode="url" value={url} onChange={(event) => setUrl(event.target.value)} aria-describedby="manual-url-help" /><p className={`helper ${validUrl ? "" : "field-error"}`} id="manual-url-help">{validUrl ? "Used only for citations and saved history. Paste the article or bill text below." : "Enter a full http:// or https:// URL."}</p></div>
            <div className="field"><label htmlFor="manual-text">Article or bill text</label><textarea id="manual-text" value={text} onChange={(event) => setText(event.target.value)} /><p className="helper">Paste at least 120 characters. The full pasted text is analyzed in memory and is not saved unless you save the resulting analysis.</p></div>
          </div>
        </div>
        <div className="panel-footer"><button className="secondary-button" type="submit" disabled={!canAnalyze}>Analyze pasted text</button></div>
      </form>
      <section className="privacy-note" aria-label="Privacy summary">
        <strong>Private by default</strong>
        <p>Analysis runs locally. Page access is used only when you press Analyze. Saved analyses and feedback stay in extension storage; no data is sent to a server.</p>
      </section>
    </>
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

  async function runPageAnalysis() {
    setLoading(true); setError(null); setNotice(null);
    try {
      const page = await extractActivePage();
      if (page.text.trim().length < 120) throw new Error("The extracted text was too short. Paste article or bill text manually.");
      setAnalysis(analyzePage(page)); setActiveTab("analysis");
    } catch (event) {
      setError(event instanceof Error ? event.message : "Analysis failed.");
    } finally { setLoading(false); }
  }

  function runManualAnalysis(text: string, type: ContentType, metadata: { title?: string; url?: string; sourceName?: string }) {
    setError(null); setNotice(null);
    try { setAnalysis(analyzePage(createManualPage(text, type, metadata))); setActiveTab("analysis"); }
    catch (event) { setError(event instanceof Error ? event.message : "Analysis failed."); }
  }

  async function saveCurrentAnalysis() {
    if (!analysis) return;
    try {
      const result = await saveAnalysis(toSavedAnalysis(analysis), () => window.confirm("You already have 50 saved analyses. Delete the oldest saved item to make room?"));
      if (result.saved) { setSaved(await getSavedAnalyses()); setNotice("Analysis saved locally."); }
      else setNotice("Analysis was not saved; your existing history was left unchanged.");
    } catch { setError("The analysis could not be saved. Check extension storage and try again."); }
  }

  async function removeSaved(id: string) {
    try { setSaved(await deleteSavedAnalysis(id)); setNotice("Saved analysis deleted."); }
    catch { setError("The saved analysis could not be deleted."); }
  }

  async function clearHistory() {
    if (!window.confirm("Delete all saved analyses from this device?")) return;
    try { setSaved(await clearSavedAnalyses()); setNotice("Saved history cleared."); }
    catch { setError("Saved history could not be cleared."); }
  }

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: "analysis", label: "Analysis", icon: <FileText size={15} /> },
    { id: "evidence", label: "Evidence", icon: <SealWarning size={15} /> },
    { id: "history", label: "History", icon: <ClockCounterClockwise size={15} /> },
    { id: "feedback", label: "Feedback", icon: <Sparkle size={15} /> }
  ];

  function moveTab(event: React.KeyboardEvent<HTMLButtonElement>, current: Tab) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === current);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    const next = tabs[nextIndex].id;
    setActiveTab(next);
    requestAnimationFrame(() => document.getElementById(`tab-${next}`)?.focus());
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-name">unframed</span><span className="brand-subtitle">Read politics with context</span></div>
        <button className="primary-button" type="button" onClick={runPageAnalysis} disabled={loading}><Sparkle size={17} weight="bold" /> Analyze</button>
      </header>
      <div className="content">
        <nav className="tabs" role="tablist" aria-label="unframed sections">
          {tabs.map((tab) => (
            <button id={`tab-${tab.id}`} key={tab.id} className={`tab-button ${activeTab === tab.id ? "is-active" : ""}`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`panel-${tab.id}`} tabIndex={activeTab === tab.id ? 0 : -1} onKeyDown={(event) => moveTab(event, tab.id)} onClick={() => { setActiveTab(tab.id); setNotice(null); }}>{tab.icon}{tab.label}</button>
          ))}
        </nav>
        {error && <div className="error-panel" role="alert"><strong><WarningCircle size={16} /> Issue</strong><p className="item-copy">{error}</p></div>}
        {notice && <div className="notice-panel" role="status">{notice}</div>}
        {loading ? <LoadingState /> : (
          <section id={`panel-${activeTab}`} role="tabpanel" aria-labelledby={`tab-${activeTab}`}>
            {activeTab === "analysis" && (analysis ? <AnalysisView analysis={analysis} onSaveAnalysis={saveCurrentAnalysis} onNewAnalysis={() => { setAnalysis(null); setError(null); setNotice(null); }} /> : <ManualFallback onAnalyze={runManualAnalysis} />)}
            {activeTab === "evidence" && <EvidenceView analysis={analysis} />}
            {activeTab === "history" && <HistoryView saved={saved} onOpen={(next) => { setAnalysis(next); setActiveTab("analysis"); }} onDelete={removeSaved} onClear={clearHistory} />}
            {activeTab === "feedback" && <FeedbackView analysis={analysis} />}
          </section>
        )}
      </div>
    </main>
  );
}
