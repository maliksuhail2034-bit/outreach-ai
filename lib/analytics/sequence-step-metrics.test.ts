import { describe, expect, it } from "vitest";
import type { StepEngagementRow } from "@/lib/db/campaign-engagement";
import {
  identifyBestStep,
  identifyBiggestStepDropOff,
  identifyWeakestStep,
  summarizeStepEngagement,
  type SequenceStepMetricsInput,
} from "./sequence-step-metrics";

const STEPS: SequenceStepMetricsInput[] = [
  { stepId: "step-1", order: 1, label: "Step 1" },
  { stepId: "step-2", order: 2, label: "Step 2" },
  { stepId: "step-3", order: 3, label: "Step 3" },
];

function row(stepId: string, overrides: Partial<StepEngagementRow> = {}): StepEngagementRow {
  return {
    step_id: stepId,
    step_order: 0,
    subject: null,
    condition: "always",
    sent: 0,
    unique_opened: 0,
    unique_clicked: 0,
    unique_replied: 0,
    ...overrides,
  };
}

describe("summarizeStepEngagement", () => {
  it("turns each step's people counts into rates out of the people it was sent to", () => {
    const [first] = summarizeStepEngagement(STEPS, [
      row("step-1", { sent: 40, unique_opened: 20, unique_clicked: 6, unique_replied: 2 }),
    ]);

    expect(first).toEqual({
      stepId: "step-1",
      order: 1,
      label: "Step 1",
      sentCount: 40,
      openedCount: 20,
      clickedCount: 6,
      repliedCount: 2,
      openRate: 50,
      clickRate: 15,
      replyRate: 5,
    });
  });

  it("shows a step with no engagement row as unsent, with no rates", () => {
    const result = summarizeStepEngagement(STEPS, [row("step-1", { sent: 5 })]);
    expect(result[2]).toMatchObject({ sentCount: 0, openedCount: 0, openRate: null, clickRate: null, replyRate: null });
  });

  it("ignores rows for steps not in the sequence", () => {
    const result = summarizeStepEngagement(STEPS, [row("deleted-step", { sent: 99 })]);
    expect(result.every((step) => step.sentCount === 0)).toBe(true);
  });
});

describe("identifyBestStep / identifyWeakestStep", () => {
  it("picks the highest and lowest reply-rate steps", () => {
    const summaries = summarizeStepEngagement(STEPS, [
      row("step-1", { sent: 100, unique_replied: 6 }),
      row("step-2", { sent: 100, unique_replied: 1 }),
    ]);

    expect(identifyBestStep(summaries)?.stepId).toBe("step-1");
    expect(identifyWeakestStep(summaries)?.stepId).toBe("step-2");
  });

  it("excludes steps with no sends (null reply rate) from both comparisons", () => {
    const summaries = summarizeStepEngagement(STEPS, [row("step-1", { sent: 1 })]);
    expect(identifyBestStep(summaries)?.stepId).toBe("step-1");
    expect(identifyWeakestStep(summaries)?.stepId).toBe("step-1");
  });

  it("returns null for both when no step has a real reply rate", () => {
    const summaries = summarizeStepEngagement(STEPS, []);
    expect(identifyBestStep(summaries)).toBeNull();
    expect(identifyWeakestStep(summaries)).toBeNull();
  });
});

describe("identifyBiggestStepDropOff", () => {
  it("identifies the step transition with the biggest sent-count attrition", () => {
    const summaries = summarizeStepEngagement(STEPS, [
      row("step-1", { sent: 100 }),
      row("step-2", { sent: 90 }),
      row("step-3", { sent: 20 }),
    ]);

    const result = identifyBiggestStepDropOff(summaries);
    expect(result?.fromKey).toBe("step-2");
    expect(result?.toKey).toBe("step-3");
  });

  it("returns null with fewer than two steps that have any sends", () => {
    const summaries = summarizeStepEngagement([{ stepId: "only-step", order: 1, label: "Step 1" }], [row("only-step", { sent: 1 })]);
    expect(identifyBiggestStepDropOff(summaries)).toBeNull();
  });

  it("returns null when every step has zero sends", () => {
    expect(identifyBiggestStepDropOff(summarizeStepEngagement(STEPS, []))).toBeNull();
  });
});
