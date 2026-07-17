import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzePage } from "./analysis";
import { perspectiveFeedbackTarget } from "../ui/components/DetectionFeedback";
import {
  buildFeedbackExport,
  buildFeedbackRecord,
  calculateFeedbackMetrics,
  clearDetectionFeedback,
  deleteDetectionFeedback,
  FEEDBACK_STORAGE_KEY,
  feedbackExportFilename,
  getFeedbackRecords,
  parseFeedbackRecords,
  saveDetectionFeedback,
  stableDetectionId,
  type DetectionFeedbackTarget,
  type FeedbackRecord
} from "./feedback";

afterEach(() => vi.unstubAllGlobals());

function makeAnalysis() {
  return analyzePage({
    title: "Council debates résumé rules",
    url: "https://example.com/policy",
    sourceName: "Example",
    author: "",
    publishedAt: "",
    contentType: "article",
    links: [],
    text: "Council member Ana Pérez called the proposal a reckless mandate. She said the measure would increase costs for small offices. The committee will vote next week after a public hearing."
  });
}

function target(overrides: Partial<DetectionFeedbackTarget> = {}): DetectionFeedbackTarget {
  return {
    excerpt: "reckless mandate",
    context: "Council member Ana Pérez called the proposal a reckless mandate.",
    modelLabel: "loaded_language",
    modelExplanation: "The phrase adds a negative evaluation.",
    modelConfidence: 0.82,
    detectionType: "phrase",
    dimension: "political",
    ...overrides
  };
}

function installChromeStorage(initial: Record<string, unknown> = {}) {
  const stored = { ...initial };
  const get = vi.fn(async (key: string) => ({ [key]: stored[key] }));
  const set = vi.fn(async (items: Record<string, unknown>) => { Object.assign(stored, items); });
  vi.stubGlobal("chrome", {
    runtime: { getManifest: () => ({ version: "0.2.0" }) },
    storage: { local: { get, set } }
  });
  return { stored, get, set };
}

describe("detection feedback storage", () => {
  it("saves accurate feedback and loads it after a fresh read", async () => {
    installChromeStorage();
    const saved = await saveDetectionFeedback(makeAnalysis(), target(), "accurate", null);
    expect(saved.records).toHaveLength(1);
    expect(saved.record.user_feedback).toEqual({ accuracy: "accurate", corrected_label: null });
    await expect(getFeedbackRecords()).resolves.toEqual(saved.records);
  });

  it("saves inaccurate feedback with a corrected label", async () => {
    installChromeStorage();
    const result = await saveDetectionFeedback(makeAnalysis(), target(), "inaccurate", "persuasion");
    expect(result.record.user_feedback).toEqual({ accuracy: "inaccurate", corrected_label: "persuasion" });
  });

  it("updates a prior response instead of creating a duplicate", async () => {
    installChromeStorage();
    const analysis = makeAnalysis();
    const first = await saveDetectionFeedback(analysis, target(), "inaccurate", "persuasion");
    const second = await saveDetectionFeedback(analysis, target(), "accurate", null);
    expect(second.records).toHaveLength(1);
    expect(second.record.feedback_id).toBe(first.record.feedback_id);
    expect(second.record.revision).toBe(2);
    expect(second.record.user_feedback).toEqual({ accuracy: "accurate", corrected_label: null });
  });

  it("deletes one feedback record and clears all records", async () => {
    installChromeStorage();
    const analysis = makeAnalysis();
    const first = await saveDetectionFeedback(analysis, target(), "accurate", null);
    await saveDetectionFeedback(analysis, target({ excerpt: "increase costs", context: "She said the measure would increase costs for small offices." }), "inaccurate", "neutral_not_biased");
    const afterDelete = await deleteDetectionFeedback(first.record.detection.detection_id);
    expect(afterDelete).toHaveLength(1);
    await expect(clearDetectionFeedback()).resolves.toEqual([]);
    await expect(getFeedbackRecords()).resolves.toEqual([]);
  });

  it("reports storage failures without silently claiming feedback was saved", async () => {
    vi.stubGlobal("chrome", {
      runtime: { getManifest: () => ({ version: "0.2.0" }) },
      storage: { local: { get: vi.fn().mockRejectedValue(new Error("quota unavailable")), set: vi.fn() } }
    });
    await expect(getFeedbackRecords()).rejects.toThrow(/could not be read/i);
  });
});

describe("feedback schema and export", () => {
  it("creates stable IDs for the same model output", () => {
    const one = stableDetectionId(makeAnalysis().url, target());
    const two = stableDetectionId(makeAnalysis().url, { ...target() });
    const different = stableDetectionId(makeAnalysis().url, target({ excerpt: "different" }));
    expect(one).toBe(two);
    expect(one).not.toBe(different);
  });

  it("exports valid empty JSON data with a date-based filename", () => {
    const output = buildFeedbackExport([], "0.2.0", "2026-07-15T12:00:00.000Z");
    expect(JSON.parse(JSON.stringify(output))).toEqual(output);
    expect(output.summary.total_feedback_records).toBe(0);
    expect(output.records).toEqual([]);
    expect(feedbackExportFilename(new Date("2026-07-15T12:00:00.000Z"))).toBe("framecheck-feedback-2026-07-15.json");
  });

  it("preserves quotes, line breaks, and Unicode in exported feedback", () => {
    const record = buildFeedbackRecord(
      makeAnalysis(),
      target({ excerpt: "“résumé”\npolicy", context: "Ana Pérez discussed a résumé policy." }),
      "inaccurate",
      "neutral_not_biased",
      undefined,
      "2026-07-15T12:00:00.000Z"
    );
    const json = JSON.stringify(buildFeedbackExport([record]));
    const parsed = JSON.parse(json);
    expect(parsed.records[0].detection.excerpt).toContain("résumé");
    expect(parsed.records[0].detection.excerpt).toContain("\n");
    expect(parsed.records[0].detection.context).toContain("Pérez");
  });

  it("stores Perspectives feedback with the local attribution model metadata", () => {
    const source = {
      canonicalId: "source-jane-smith",
      displayName: "Jane Smith",
      aliases: ["Jane Smith"],
      entityType: "person" as const,
      sourceRoles: ["quoted" as const],
      contributionSummary: "Said the plan would reduce travel times.",
      evidence: [{ evidenceText: '"The plan will reduce travel times," Jane Smith said.', attributionType: "direct_quote" as const }],
      mentionCount: 1
    };
    const feedbackTarget = perspectiveFeedbackTarget(source, source.evidence[0]);
    const record = buildFeedbackRecord(makeAnalysis(), feedbackTarget, "inaccurate", "paraphrased");
    expect(record.detection).toMatchObject({ model_label: "direct_quote", detection_type: "sentence" });
    expect(record.user_feedback.corrected_label).toBe("paraphrased");
    expect(record.model_metadata.model).toBe("Ellipsis explicit-attribution parser");
  });

  it("drops malformed stored records instead of crashing", () => {
    const valid = buildFeedbackRecord(makeAnalysis(), target(), "accurate", null);
    expect(parseFeedbackRecords({ schema_version: "1.0", records: [{ broken: true }, valid] })).toEqual([valid]);
    expect(parseFeedbackRecords("not records")).toEqual([]);
  });
});

describe("feedback discrepancy metrics", () => {
  it("calculates disagreement by label, type, correction, and confidence", () => {
    const analysis = makeAnalysis();
    const records: FeedbackRecord[] = [
      buildFeedbackRecord(analysis, target({ modelConfidence: 0.4 }), "inaccurate", "persuasion"),
      buildFeedbackRecord(analysis, target({ excerpt: "reckless", context: "A reckless plan.", modelConfidence: 0.5, detectionType: "word" }), "inaccurate", "neutral_not_biased"),
      buildFeedbackRecord(analysis, target({ excerpt: "increase costs", context: "It would increase costs.", modelConfidence: 0.9 }), "accurate", null)
    ];
    const metrics = calculateFeedbackMetrics(records);
    expect(metrics.totalReviewed).toBe(3);
    expect(metrics.accuratePercentage).toBeCloseTo(33.3);
    expect(metrics.inaccuratePercentage).toBeCloseTo(66.7);
    expect(metrics.byModelLabel[0]).toMatchObject({ label: "loaded_language", total: 3, inaccurateCount: 2 });
    expect(metrics.byDetectionType.find((item) => item.label === "word")?.inaccurateRate).toBe(100);
    expect(metrics.confusion).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelLabel: "loaded_language", correctedLabel: "persuasion", count: 1 })
    ]));
    expect(metrics.mostCorrectedLabels).toHaveLength(2);
    expect(metrics.confidenceComparison.lowConfidence.inaccurateRate).toBe(100);
    expect(metrics.confidenceComparison.higherConfidence.inaccurateRate).toBe(0);
  });

  it("keeps the stored envelope versioned", async () => {
    const storage = installChromeStorage();
    await saveDetectionFeedback(makeAnalysis(), target(), "accurate", null);
    expect(storage.stored[FEEDBACK_STORAGE_KEY]).toMatchObject({ schema_version: "1.0" });
  });
});
