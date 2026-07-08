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
import { analyzePage, classifyPastedText } from "../lib/analysis";
import { createManualPage, extractActivePage } from "../lib/chrome";
import { deleteSavedAnalysis, getSavedAnalyses, logFeedback, saveAnalysis } from "../lib/storage";
import type { Analysis, BillAnalysis, ContentType, FeedbackType, SavedAnalysis } from "../types";

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
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
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

function SectionList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">{title}</h2>
      </div>
      <div className="panel-body">
        <ul className="section-list">
          {items.map((item) => (
            <li className="section-item" key={item}>
              <p className="item-copy">{item}</p>
            </li>
          ))}
        </ul>
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

function AnalysisView({
  analysis,
  onNewAnalysis,
  onSaveAnalysis
}: {
  analysis: Analysis;
  onNewAnalysis: () => void;
  onSaveAnalysis: () => void;
}) {
  const isLowConfidence = analysis.confidenceScore < 50;
  const isBill = analysis.contentType === "bill";
  const confidenceText = `${analysis.confidenceScore}%`;

  return (
    <>
      {isLowConfidence && (
        <div className="warning-panel" role="status">
          <strong>Low confidence</strong>
          <p className="item-copy">
            Unframed has low confidence in parts of this analysis because the source text may be incomplete. Review the cited evidence before relying on this summary.
          </p>
        </div>
      )}

      <section className="panel">
        <div className="panel-header">
          <div className="result-head">
            <h1 className="page-title">{analysis.pageTitle}</h1>
            <div className="meta-line">
              <span>{analysis.sourceName}</span>
              <span>{contentLabel(analysis.contentType)}</span>
              <span>{formatDate(analysis.createdAt)}</span>
            </div>
          </div>
          <span className={`badge ${confidenceClass(analysis.confidenceScore)}`} title={`${analysis.confidenceScore}% confidence`}>
            {confidenceText}
          </span>
        </div>
        <div className="panel-body">
          <p className="summary">{analysis.summary}</p>
          <p className="helper">{analysis.confidenceReason}</p>
        </div>
        <div className="panel-footer">
          <button className="secondary-button" type="button" onClick={onSaveAnalysis}>
            <FloppyDisk size={16} />
            Save locally
          </button>
          <button className="secondary-button" type="button" onClick={onNewAnalysis}>
            New analysis
          </button>
        </div>
      </section>

      {isBill ? <BillDetails analysis={analysis as BillAnalysis} /> : <ArticleDetails analysis={analysis} />}
    </>
  );
}

function ArticleDetails({ analysis }: { analysis: Extract<Analysis, { contentType: "article" }> }) {
  return (
    <>
      <SectionList title="Main Issue" items={[analysis.mainIssue]} />
      <SectionList title="Possible Framing" items={analysis.framingNotes} />
      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Loaded Language</h2>
        </div>
        <div className="panel-body">
          {analysis.loadedLanguageExamples.length ? (
            <ul className="section-list">
              {analysis.loadedLanguageExamples.map((item) => (
                <li className="section-item" key={`${item.phrase}-${item.context}`}>
                  <span className="item-title">{item.phrase}</span>
                  <p className="quote">{item.context}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="helper">No obvious loaded-language terms were found in the extracted text.</p>
          )}
        </div>
      </section>
      <div className="two-column">
        <SectionList title="Included" items={analysis.includedPerspectives} />
        <SectionList title="Missing or Unclear" items={analysis.missingPerspectives} />
      </div>
      <SectionList title="Quoted Sources" items={analysis.quotedPeopleOrGroups} />
    </>
  );
}

function BillDetails({ analysis }: { analysis: BillAnalysis }) {
  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">{analysis.billNumber}</h2>
            <p className="panel-description">{analysis.billTitle}</p>
          </div>
        </div>
        <div className="panel-body">
          <p className="summary">{analysis.plainLanguageSummary}</p>
        </div>
      </section>
      <SectionList title="What It Would Change" items={analysis.proposedChanges} />
      <div className="two-column">
        <SectionList title="Affected Groups" items={analysis.affectedGroups} />
        <SectionList title="Unclear Impacts" items={analysis.unclearImpacts} />
      </div>
      <div className="two-column">
        <SectionList title="Sourced Supporters" items={analysis.sourcedSupporters.length ? analysis.sourcedSupporters : ["No sourced supporters were found in the extracted text."]} />
        <SectionList title="Sourced Opponents" items={analysis.sourcedOpponents.length ? analysis.sourcedOpponents : ["No sourced opponents were found in the extracted text."]} />
      </div>
      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Important Terms</h2>
        </div>
        <div className="panel-body">
          <ul className="section-list">
            {analysis.importantTerms.map((item) => (
              <li className="section-item" key={item.term}>
                <span className="item-title">{item.term}</span>
                <p className="item-copy">{item.meaning}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}

function EvidenceView({ analysis }: { analysis: Analysis | null }) {
  if (!analysis) {
    return (
      <section className="panel">
        <div className="empty-state">
          <Archive size={24} />
          <p>No evidence yet. Analyze a page to see claims, source text, and confidence labels.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Evidence</h2>
          <p className="panel-description">Major claims are tied to source text from the active page.</p>
        </div>
      </div>
      <div className="panel-body">
        <ul className="evidence-list">
          {analysis.evidence.map((item) => (
            <li className="evidence-item" key={item.id}>
              <span className="item-title">{item.claim}</span>
              <p className="quote">{item.supportingText}</p>
              <p className="item-copy">{item.explanation}</p>
              <a className={`badge ${confidenceClass(item.confidenceScore)}`} href={item.sourceUrl} target="_blank" rel="noreferrer">
                {item.confidenceLabel} confidence
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function HistoryView({
  saved,
  onOpen,
  onDelete
}: {
  saved: SavedAnalysis[];
  onOpen: (analysis: Analysis) => void;
  onDelete: (id: string) => void;
}) {
  if (saved.length === 0) {
    return (
      <section className="panel">
        <div className="empty-state">
          <ClockCounterClockwise size={24} />
          <p>No saved analyses yet. Saved items stay local and the list is capped at 50.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Saved History</h2>
          <p className="panel-description">{saved.length} of 50 saved locally.</p>
        </div>
      </div>
      <div className="panel-body">
        <ul className="history-list">
          {saved.map((item) => (
            <li className="history-item" key={item.id}>
              <span className="item-title">{item.pageTitle}</span>
              <p className="item-copy">{item.summary}</p>
              <div className="meta-line">
                <span>{contentLabel(item.contentType)}</span>
                <span>{formatDate(item.createdAt)}</span>
                <span>{item.confidenceScore}% confidence</span>
              </div>
              <div className="actions">
                <button className="secondary-button" type="button" onClick={() => onOpen(item.analysis)}>
                  Open
                </button>
                <button className="secondary-button" type="button" onClick={() => onDelete(item.id)}>
                  <Trash size={16} />
                  Delete
                </button>
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
  const [submitted, setSubmitted] = useState(false);

  async function submitFeedback() {
    if (!analysis || !selected) return;
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
    setSubmitted(true);
    setComment("");
  }

  if (!analysis) {
    return (
      <section className="panel">
        <div className="empty-state">
          <SealWarning size={24} />
          <p>Analyze a page before submitting anonymous feedback.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Anonymous Feedback</h2>
          <p className="panel-description">Stored locally for this MVP. No account is required.</p>
        </div>
      </div>
      <div className="panel-body">
        {submitted && (
          <div className="warning-panel" role="status">
            <strong>Feedback logged</strong>
            <p className="item-copy">Your response was saved anonymously in local extension storage.</p>
          </div>
        )}
        <div className="feedback-grid">
          {feedbackTypes.map((type) => (
            <button
              className={`choice-button ${selected === type ? "is-selected" : ""}`}
              type="button"
              key={type}
              onClick={() => {
                setSelected(type);
                setSubmitted(false);
              }}
            >
              {type}
            </button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="feedback-comment">Optional comment</label>
          <textarea id="feedback-comment" value={comment} onChange={(event) => setComment(event.target.value)} />
          <p className="helper">Do not include personal information.</p>
        </div>
      </div>
      <div className="panel-footer">
        <button className="primary-button" type="button" disabled={!selected} onClick={submitFeedback}>
          Submit
        </button>
      </div>
    </section>
  );
}

function ManualFallback({ onAnalyze }: { onAnalyze: (text: string, type: ContentType) => void }) {
  const [text, setText] = useState("");
  const [type, setType] = useState<ContentType>("unknown");
  const inferredType = useMemo(() => classifyPastedText(text), [text]);
  const canAnalyze = text.trim().length >= 120;

  function submitManualAnalysis(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAnalyze) return;
    onAnalyze(text, type === "unknown" ? inferredType : type);
  }

  return (
    <form className="panel" onSubmit={submitManualAnalysis}>
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Manual Paste</h2>
          <p className="panel-description">Use this when extraction fails or the page blocks content scripts.</p>
        </div>
      </div>
      <div className="panel-body">
        <div className="form-grid">
          <div className="field">
            <label htmlFor="content-type">Content type</label>
            <select id="content-type" value={type} onChange={(event) => setType(event.target.value as ContentType)}>
              <option value="unknown">Detect from text</option>
              <option value="article">News article</option>
              <option value="bill">Congress.gov bill</option>
            </select>
            <p className="helper">Current guess: {contentLabel(inferredType)}.</p>
          </div>
          <div className="field">
            <label htmlFor="manual-text">Article or bill text</label>
            <textarea id="manual-text" value={text} onChange={(event) => setText(event.target.value)} />
            <p className="helper">Paste enough source text for evidence-backed analysis.</p>
          </div>
        </div>
      </div>
      <div className="panel-footer">
        <button className="secondary-button" type="submit" disabled={!canAnalyze}>
          Analyze pasted text
        </button>
      </div>
    </form>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("analysis");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [saved, setSaved] = useState<SavedAnalysis[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSavedAnalyses().then(setSaved).catch(() => setSaved([]));
  }, []);

  async function runPageAnalysis() {
    setLoading(true);
    setError(null);
    try {
      const page = await extractActivePage();
      if (page.text.trim().length < 120) {
        throw new Error("The extracted text was too short. Paste article or bill text manually.");
      }
      const next = analyzePage(page);
      setAnalysis(next);
      setActiveTab("analysis");
    } catch (event) {
      setError(event instanceof Error ? event.message : "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  function runManualAnalysis(text: string, type: ContentType) {
    setError(null);
    try {
      const next = analyzePage(createManualPage(text, type));
      setAnalysis(next);
      setActiveTab("analysis");
    } catch (event) {
      setError(event instanceof Error ? event.message : "Analysis failed.");
    }
  }

  async function saveCurrentAnalysis() {
    if (!analysis) return;
    const result = await saveAnalysis(toSavedAnalysis(analysis), () =>
      window.confirm("You already have 50 saved analyses. Delete the oldest saved item to make room?")
    );
    if (result.saved) setSaved(await getSavedAnalyses());
  }

  async function removeSaved(id: string) {
    setSaved(await deleteSavedAnalysis(id));
  }

  const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
    { id: "analysis", label: "Analysis", icon: <FileText size={15} /> },
    { id: "evidence", label: "Evidence", icon: <SealWarning size={15} /> },
    { id: "history", label: "History", icon: <ClockCounterClockwise size={15} /> },
    { id: "feedback", label: "Feedback", icon: <Sparkle size={15} /> }
  ];

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-name">Unframed</span>
          <span className="brand-subtitle">Read politics with context</span>
        </div>
        <button className="primary-button" type="button" onClick={runPageAnalysis} disabled={loading}>
          <Sparkle size={17} weight="bold" />
          Analyze
        </button>
      </header>

      <div className="content">
        <section className="intro-panel">
          <p className="intro-copy">
            Review framing, evidence, missing perspectives, and uncertainty.
          </p>
          <div className="tabs" role="tablist" aria-label="Unframed sections">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`tab-button ${activeTab === tab.id ? "is-active" : ""}`}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </section>

        {error && (
          <div className="error-panel" role="alert">
            <strong>
              <WarningCircle size={16} /> Extraction issue
            </strong>
            <p className="item-copy">{error}</p>
          </div>
        )}

        {loading ? (
          <LoadingState />
        ) : (
          <>
            {activeTab === "analysis" && (
              <>
                {analysis ? (
                  <AnalysisView analysis={analysis} onSaveAnalysis={saveCurrentAnalysis} onNewAnalysis={() => setAnalysis(null)} />
                ) : (
                  <ManualFallback onAnalyze={runManualAnalysis} />
                )}
              </>
            )}
            {activeTab === "evidence" && <EvidenceView analysis={analysis} />}
            {activeTab === "history" && <HistoryView saved={saved} onOpen={(next) => { setAnalysis(next); setActiveTab("analysis"); }} onDelete={removeSaved} />}
            {activeTab === "feedback" && <FeedbackView analysis={analysis} />}
          </>
        )}
      </div>
    </main>
  );
}
