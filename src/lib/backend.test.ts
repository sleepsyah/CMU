import { describe, expect, it } from "vitest";
import { isLoopbackBackendUrl, localBiasAssessment } from "./backend";

describe("evidence-linked bias scales", () => {
  it("does not infer ethnicity bias from crime words without a direct group association", () => {
    const result = localBiasAssessment(
      "City officials reported that violent crime declined across every district. Black and white residents reviewed the data before publication. The report does not claim that any demographic group caused the change."
    );

    expect(result.scores.ethnicity_bias.status).toBe("insufficient-evidence");
    expect(result.scores.ethnicity_bias.score).toBeNull();
  });

  it("requires a direct, non-negated demographic association", () => {
    const result = localBiasAssessment(
      "The column described immigrants as criminals and a threat to every neighborhood. Independent records were not cited in the article."
    );

    expect(result.scores.ethnicity_bias.status).toBe("assessed");
    expect(result.scores.ethnicity_bias.evidenceCount).toBeGreaterThan(0);
    expect(result.linguistic_evidence.signals.some((signal) => signal.dimension === "ethnicity")).toBe(true);
  });

  it("does not score a gender stereotype word without a gender association", () => {
    const result = localBiasAssessment(
      "The committee called the negotiating process emotional and chaotic. Members later published a detailed timeline of the dispute."
    );

    expect(result.scores.gender_bias.status).toBe("insufficient-evidence");
  });

  it("links political wording scores to exact cues", () => {
    const result = localBiasAssessment(
      "The mayor blasted the radical proposal as a disastrous betrayal. The council published the proposal later that afternoon."
    );

    expect(result.scores.political_bias.status).toBe("assessed");
    expect(result.scores.political_bias.evidenceCount).toBeGreaterThan(0);
    expect(result.linguistic_evidence.signals.every((signal) => signal.context.length > 0)).toBe(true);
  });
});

describe("local helper privacy boundary", () => {
  it("accepts only explicit loopback HTTP endpoints", () => {
    expect(isLoopbackBackendUrl("http://127.0.0.1:8000")).toBe(true);
    expect(isLoopbackBackendUrl("http://localhost:8000")).toBe(true);
    expect(isLoopbackBackendUrl("https://api.example.com")).toBe(false);
    expect(isLoopbackBackendUrl("http://192.168.1.20:8000")).toBe(false);
  });
});
