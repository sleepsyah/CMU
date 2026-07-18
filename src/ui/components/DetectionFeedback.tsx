import { Check, DownloadSimple, Trash, X } from "@phosphor-icons/react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  calculateFeedbackMetrics,
  clearDetectionFeedback,
  deleteDetectionFeedback,
  downloadFeedbackExport,
  feedbackLabel,
  getFeedbackRecords,
  saveDetectionFeedback,
  stableDetectionId,
  type DetectionFeedbackTarget,
  type FeedbackAccuracy,
  type FeedbackLabel,
  type FeedbackRecord
} from "../../lib/feedback";
import type { Analysis, ArticleSource, BiasDimension, BiasMetric, BiasSignal, SourceEvidence } from "../../types";

interface FeedbackContextValue {
  analysis: Analysis;
  records: FeedbackRecord[];
  error: string | null;
  save: (target: DetectionFeedbackTarget, accuracy: FeedbackAccuracy, correctedLabel: FeedbackLabel | null) => Promise<void>;
  remove: (detectionId: string) => Promise<void>;
  clear: () => Promise<void>;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);
const categoryCorrections: FeedbackLabel[] = [
  "loaded_language",
  "epistemic_framing",
  "persuasion",
  "stereotype_association",
  "neutral_not_biased"
];
const dimensionCorrections: FeedbackLabel[] = ["political", "gender", "ethnicity", "class", "neutral_not_biased"];
const attributionCorrections: FeedbackLabel[] = [
  "direct_quote",
  "paraphrased",
  "official_statement",
  "anonymous_attribution",
  "document_source",
  "declined_comment",
  "denial",
  "mentioned_only"
];

export function FeedbackProvider({ analysis, children }: { analysis: Analysis; children: React.ReactNode }) {
  const [records, setRecords] = useState<FeedbackRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getFeedbackRecords()
      .then((next) => { if (active) setRecords(next); })
      .catch((event) => { if (active) setError(event instanceof Error ? event.message : "Saved feedback could not be loaded."); });
    return () => { active = false; };
  }, [analysis.id]);

  async function save(target: DetectionFeedbackTarget, accuracy: FeedbackAccuracy, correctedLabel: FeedbackLabel | null) {
    try {
      const result = await saveDetectionFeedback(analysis, target, accuracy, correctedLabel);
      setRecords(result.records);
      setError(result.trimmed ? "Feedback was saved. The oldest record was removed because the local limit is 1,000." : null);
    } catch (event) {
      const message = event instanceof Error ? event.message : "Feedback could not be saved.";
      setError(message);
      throw event;
    }
  }

  async function remove(detectionId: string) {
    try {
      setRecords(await deleteDetectionFeedback(detectionId));
      setError(null);
    } catch (event) {
      const message = event instanceof Error ? event.message : "Feedback could not be deleted.";
      setError(message);
      throw event;
    }
  }

  async function clear() {
    try {
      setRecords(await clearDetectionFeedback());
      setError(null);
    } catch (event) {
      const message = event instanceof Error ? event.message : "Feedback could not be cleared.";
      setError(message);
      throw event;
    }
  }

  return <FeedbackContext.Provider value={{ analysis, records, error, save, remove, clear }}>{children}</FeedbackContext.Provider>;
}

function useFeedback() {
  const value = useContext(FeedbackContext);
  if (!value) throw new Error("Detection feedback controls must be rendered inside FeedbackProvider.");
  return value;
}

export function signalFeedbackTarget(signal: BiasSignal, confidence: number): DetectionFeedbackTarget {
  return {
    excerpt: signal.phrase,
    context: signal.context,
    modelLabel: signal.category,
    modelExplanation: signal.explanation,
    modelConfidence: confidence,
    detectionType: signal.phrase.trim().split(/\s+/).length === 1 ? "word" : "phrase",
    correctionOptions: categoryCorrections,
    dimension: signal.dimension
  };
}

export function indicatorFeedbackTarget(
  dimension: BiasDimension,
  label: string,
  metric: BiasMetric,
  signals: BiasSignal[]
): DetectionFeedbackTarget {
  return {
    excerpt: `${label} bias: ${metric.score === null ? "not assessed" : `${Math.round(metric.score)}/100`}`,
    context: signals.map((signal) => signal.context).slice(0, 3).join(" "),
    modelLabel: dimension,
    modelExplanation: signals.length
      ? `This score combines ${signals.length} source-linked ${signals.length === 1 ? "cue" : "cues"} for the ${label.toLowerCase()} dimension.`
      : `The model did not find enough source-linked evidence to assess the ${label.toLowerCase()} dimension.`,
    modelConfidence: metric.confidence,
    detectionType: "indicator",
    correctionOptions: dimensionCorrections,
    dimension
  };
}

export function perspectiveFeedbackTarget(source: ArticleSource, evidence: SourceEvidence): DetectionFeedbackTarget {
  return {
    excerpt: evidence.evidenceText,
    context: evidence.evidenceText,
    modelLabel: evidence.attributionType,
    modelExplanation: `Ellipsis identified ${source.displayName} as an explicitly attributed source. ${source.contributionSummary}`,
    modelConfidence: null,
    detectionType: "sentence",
    correctionOptions: attributionCorrections,
    modelMetadata: {
      provider: "On-device local analysis",
      model: "Ellipsis explicit-attribution parser",
      promptVersion: "ellipsis-source-attribution-v1"
    }
  };
}

export function DetectionFeedbackControl({ target, label = "Review detection" }: { target: DetectionFeedbackTarget; label?: string }) {
  const { analysis, records, save, remove } = useFeedback();
  const detectionId = stableDetectionId(analysis.url, target);
  const existing = records.find((record) => record.detection.detection_id === detectionId);
  const [status, setStatus] = useState<string | null>(null);
  const options = target.correctionOptions || categoryCorrections;

  useEffect(() => setStatus(null), [detectionId]);

  async function rate(accuracy: FeedbackAccuracy) {
    try {
      const corrected = accuracy === "inaccurate" ? existing?.user_feedback.corrected_label || null : null;
      await save(target, accuracy, corrected);
      setStatus("Saved locally.");
    } catch {
      setStatus("Could not save.");
    }
  }

  async function correct(label: FeedbackLabel) {
    try {
      await save(target, "inaccurate", label);
      setStatus("Correction saved locally.");
    } catch {
      setStatus("Could not save correction.");
    }
  }

  async function removeCurrent() {
    try {
      await remove(detectionId);
      setStatus("Feedback deleted.");
    } catch {
      setStatus("Could not delete feedback.");
    }
  }

  return (
    <details className="detection-feedback" data-detection-id={detectionId}>
      <summary>
        {label}
        {existing && <span className={`feedback-state is-${existing.user_feedback.accuracy}`}>{existing.user_feedback.accuracy === "accurate" ? "Accurate" : "Inaccurate"}</span>}
      </summary>
      <div className="detection-feedback-body">
        <div className="feedback-choice-row" role="group" aria-label="Detection accuracy">
          <button className={existing?.user_feedback.accuracy === "accurate" ? "is-selected" : ""} type="button" aria-pressed={existing?.user_feedback.accuracy === "accurate"} onClick={() => void rate("accurate")}><Check size={13} />Accurate</button>
          <button className={existing?.user_feedback.accuracy === "inaccurate" ? "is-selected" : ""} type="button" aria-pressed={existing?.user_feedback.accuracy === "inaccurate"} onClick={() => void rate("inaccurate")}><X size={13} />Inaccurate</button>
        </div>
        {existing?.user_feedback.accuracy === "inaccurate" && (
          <label className="feedback-correction">
            <span>Correct label</span>
            <select value={existing.user_feedback.corrected_label || ""} onChange={(event) => { if (event.target.value) void correct(event.target.value as FeedbackLabel); }}>
              <option value="">Choose a label</option>
              {options.filter((label) => label !== target.modelLabel).map((label) => <option value={label} key={label}>{feedbackLabel(label)}</option>)}
            </select>
          </label>
        )}
        <div className="feedback-record-note">
          <span>{status || "Saved only on this device."}</span>
          {existing && <button type="button" onClick={() => void removeCurrent()}><Trash size={12} />Delete</button>}
        </div>
      </div>
    </details>
  );
}

function RateList({ title, groups }: { title: string; groups: Array<{ label: string; total: number; inaccurateRate: number }> }) {
  if (!groups.length) return null;
  return (
    <div className="feedback-rate-group">
      <strong>{title}</strong>
      <ul>{groups.map((group) => <li key={group.label}><span>{feedbackLabel(group.label)}</span><span>{group.inaccurateRate}% inaccurate · {group.total} reviewed</span></li>)}</ul>
    </div>
  );
}

export function FeedbackEvaluationPanel() {
  const { records, error, clear } = useFeedback();
  const metrics = useMemo(() => calculateFeedbackMetrics(records), [records]);
  const [status, setStatus] = useState<string | null>(null);

  function exportRecords() {
    try {
      const filename = downloadFeedbackExport(records);
      setStatus(`${filename} exported.`);
    } catch {
      setStatus("Feedback export could not be created.");
    }
  }

  async function clearAll() {
    if (!window.confirm("Delete all detection feedback saved on this device?")) return;
    try {
      await clear();
      setStatus("All local detection feedback was cleared.");
    } catch {
      setStatus("Feedback could not be cleared.");
    }
  }

  return (
    <section className="prototype-section feedback-evaluation" data-testid="feedback-evaluation">
      <div className="prototype-heading-row">
        <span className="prototype-label">Model evaluation</span>
        <span>{metrics.totalReviewed} reviewed</span>
      </div>
      <p>Detection feedback is saved locally and can be exported as JSON. It measures disagreement; it does not retrain or fine-tune a model.</p>
      {(error || status) && <div className={error ? "feedback-error" : "feedback-status"} role="status">{error || status}</div>}
      <div className="feedback-summary-grid">
        <div><strong>{metrics.totalReviewed}</strong><span>Total reviewed</span></div>
        <div><strong>{metrics.accuratePercentage}%</strong><span>Accurate</span></div>
        <div><strong>{metrics.inaccuratePercentage}%</strong><span>Inaccurate</span></div>
      </div>
      <div className="feedback-actions">
        <button className="secondary-button" type="button" onClick={exportRecords}><DownloadSimple size={14} />Export feedback</button>
        <button className="text-button" type="button" disabled={!records.length} onClick={() => void clearAll()}><Trash size={13} />Clear all</button>
      </div>
      {records.length > 0 ? (
        <details className="minor-disclosure feedback-metrics">
          <summary>Disagreement details</summary>
          <div className="feedback-metrics-body">
            <RateList title="By model label" groups={metrics.byModelLabel} />
            <RateList title="By detection type" groups={metrics.byDetectionType} />
            <RateList title="By confidence" groups={[metrics.confidenceComparison.lowConfidence, metrics.confidenceComparison.higherConfidence].filter((group) => group.total > 0)} />
            {metrics.confusion.length > 0 && (
              <div className="feedback-rate-group">
                <strong>Model label → corrected label</strong>
                <ul>{metrics.confusion.map((item) => <li key={`${item.modelLabel}-${item.correctedLabel}`}><span>{feedbackLabel(item.modelLabel)} → {feedbackLabel(item.correctedLabel)}</span><span>{item.count}</span></li>)}</ul>
              </div>
            )}
            {metrics.mostCorrectedLabels.length > 0 && <p className="feedback-most-corrected">Most common corrections: {metrics.mostCorrectedLabels.map((item) => `${feedbackLabel(item.label)} (${item.count})`).join(", ")}.</p>}
          </div>
        </details>
      ) : <p className="panel-empty">No detections have been reviewed yet. Export still produces a valid empty dataset.</p>}
    </section>
  );
}
