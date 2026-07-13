import { CaretDown } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import type { BackendBiasAnalysis, BiasProfile, BiasSignal, FrameSignal } from "../../types";
import AnimatedContent from "../reactbits/AnimatedContent";
import CountUp from "../reactbits/CountUp";

function tone(score: number | null) {
  if (score === null) return "neutral";
  if (score < 34) return "low";
  if (score < 67) return "moderate";
  return "high";
}

function categoryLabel(category: BiasSignal["category"]) {
  if (category === "loaded_language") return "Loaded wording";
  if (category === "epistemic_framing") return "Certainty framing";
  if (category === "persuasion") return "Persuasive framing";
  return "Stereotype association";
}

function severityLabel(severity: BiasSignal["severity"]) {
  if (severity === 3) return "Strong";
  if (severity === 2) return "Moderate";
  return "Mild";
}

function conciseSentence(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  const firstSentence = text.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || text;
  return firstSentence.length <= 130 ? firstSentence : `${firstSentence.slice(0, 127).trimEnd()}...`;
}

export function BiasSignalChart({ assessment }: { assessment: BackendBiasAnalysis }) {
  const rows = [
    { label: "Political", dimension: "political" as const, metric: assessment.scores.political_bias },
    { label: "Gender", dimension: "gender" as const, metric: assessment.scores.gender_bias },
    { label: "Ethnicity", dimension: "ethnicity" as const, metric: assessment.scores.ethnicity_bias }
  ];
  const reduceMotion = useReducedMotion();

  return (
    <AnimatedContent className="signal-chart" distance={5}>
      {rows.map(({ label, dimension, metric }, index) => {
        const score = metric.status === "assessed" && metric.score !== null ? Math.round(metric.score) : null;
        const signals = assessment.linguistic_evidence.signals.filter((signal) => signal.dimension === dimension);
        if (score === null || !signals.length) {
          return (
            <div className="signal-chart-row is-empty" key={label}>
              <div className="signal-chart-label"><span>{label}</span></div>
              <span className="signal-no-evidence">No direct evidence found</span>
            </div>
          );
        }
        const evidence = signals.length === 1 ? "1 passage" : `${signals.length} passages`;
        return (
          <details className="signal-disclosure" key={label}>
            <summary className="signal-chart-row">
              <div className="signal-chart-label"><span>{label}</span><span>{evidence}</span></div>
              <div className={`signal-track is-${tone(score)}`} aria-hidden="true">
                <motion.span
                  className="signal-fill"
                  initial={reduceMotion ? { width: `${score}%` } : { width: 0 }}
                  animate={{ width: `${score}%` }}
                  transition={{ duration: 0.42, delay: index * 0.05, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
              <span className={`signal-value is-${tone(score)}`}>
                <span role="progressbar" aria-label={`${label} detected signal`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={score}><CountUp to={score} />/100</span>
                <CaretDown className="signal-caret" size={12} aria-hidden="true" />
              </span>
            </summary>
            <div className="signal-details">
              <ul>
                {signals.map((signal) => (
                  <li key={signal.id}>
                    <blockquote>{signal.context}</blockquote>
                    <p><strong>{categoryLabel(signal.category)} · {severityLabel(signal.severity)}</strong> {conciseSentence(signal.explanation)}</p>
                  </li>
                ))}
              </ul>
              <p className="signal-method">Score weighs {evidence} by cue strength · {Math.round(metric.confidence * 100)}% evidence confidence</p>
            </div>
          </details>
        );
      })}
    </AnimatedContent>
  );
}

export function BiasProfileBand({ profile }: { profile: BiasProfile }) {
  const score = Math.max(0, Math.min(100, Math.round(profile.score)));
  const filled = Math.round(score / 10);
  return (
    <div className={`confidence-band is-${tone(score)}`}>
      <div className="confidence-copy">
        <span>Overall bias profile</span>
        <strong><CountUp to={score} />/100</strong>
      </div>
      <div className="confidence-segments" role="progressbar" aria-label="Overall article bias" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score}>
        {Array.from({ length: 10 }, (_, index) => <span className={index < filled ? "is-filled" : ""} key={index} />)}
      </div>
      <p>{profile.summary}</p>
    </div>
  );
}

export function FramingBars({ frames }: { frames: FrameSignal[] }) {
  if (!frames.length) return <p className="helper">No dominant framing pattern found.</p>;
  return (
    <div className="frame-bars">
      {frames.map((frame) => (
        <div className="frame-row" key={frame.id}>
          <div><strong>{frame.label}</strong><span>{frame.source === "local-codex" ? "AI + source evidence" : "Local source evidence"}</span></div>
          <div className="frame-bar" aria-hidden="true"><span style={{ width: `${frame.strength}%` }} /></div>
          <span><CountUp to={frame.strength} /></span>
        </div>
      ))}
    </div>
  );
}
