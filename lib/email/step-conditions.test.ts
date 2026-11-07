import { describe, expect, it } from "vitest";
import { isStepConditionMet, type ConditionalStep, type StepEngagement } from "./step-conditions";

function step(id: string, order: number, condition = "always", conditionStepId: string | null = null): ConditionalStep {
  return { id, step_order: order, condition, condition_step_id: conditionStepId };
}

const ONE = step("s1", 0);
const TWO = step("s2", 1);

function met(target: ConditionalStep, sent: string[], engagement: StepEngagement[], steps = [ONE, TWO, target]) {
  return isStepConditionMet({ step: target, steps, sentStepIds: new Set(sent), engagement });
}

const opened = (sequenceStepId: string): StepEngagement => ({ eventType: "opened", sequenceStepId });
const clicked = (sequenceStepId: string): StepEngagement => ({ eventType: "clicked", sequenceStepId });

describe("isStepConditionMet", () => {
  it("always sends an 'always' step, even with nothing sent before", () => {
    expect(met(step("s3", 2), [], [])).toBe(true);
  });

  it("opened / not opened a chosen step", () => {
    expect(met(step("s3", 2, "opened", "s1"), ["s1", "s2"], [opened("s1")])).toBe(true);
    expect(met(step("s3", 2, "opened", "s1"), ["s1", "s2"], [opened("s2")])).toBe(false);
    expect(met(step("s3", 2, "not_opened", "s1"), ["s1", "s2"], [opened("s2")])).toBe(true);
    expect(met(step("s3", 2, "not_opened", "s1"), ["s1", "s2"], [opened("s1")])).toBe(false);
  });

  it("clicked / not clicked a chosen step", () => {
    expect(met(step("s3", 2, "clicked", "s2"), ["s1", "s2"], [clicked("s2")])).toBe(true);
    expect(met(step("s3", 2, "clicked", "s2"), ["s1", "s2"], [opened("s2"), clicked("s1")])).toBe(false);
    expect(met(step("s3", 2, "not_clicked", "s2"), ["s1", "s2"], [opened("s2")])).toBe(true);
    expect(met(step("s3", 2, "not_clicked", "s2"), ["s1", "s2"], [clicked("s2")])).toBe(false);
  });

  it("treats a click as an open (images blocked)", () => {
    expect(met(step("s3", 2, "opened", "s1"), ["s1"], [clicked("s1")])).toBe(true);
    expect(met(step("s3", 2, "not_opened", "s1"), ["s1"], [clicked("s1")])).toBe(false);
  });

  it("with no chosen step, looks at every earlier step that was sent", () => {
    expect(met(step("s3", 2, "opened"), ["s1", "s2"], [opened("s2")])).toBe(true);
    expect(met(step("s3", 2, "not_opened"), ["s1", "s2"], [])).toBe(true);
    expect(met(step("s3", 2, "not_opened"), ["s1", "s2"], [opened("s1")])).toBe(false);
  });

  it("never meets a condition on a step the lead was never sent (skipped)", () => {
    expect(met(step("s3", 2, "opened", "s2"), ["s1"], [opened("s1")])).toBe(false);
    expect(met(step("s3", 2, "not_opened", "s2"), ["s1"], [])).toBe(false);
  });

  it("is not met for a conditional first step (nothing earlier)", () => {
    const first = step("s0", -1, "not_opened");
    expect(met(first, [], [])).toBe(false);
  });

  it("ignores engagement with a later step, the step itself, or no step", () => {
    const target = step("s2", 1, "opened");
    expect(isStepConditionMet({ step: target, steps: [ONE, target, step("s3", 2)], sentStepIds: new Set(["s1", "s3"]), engagement: [opened("s3"), opened("s2"), { eventType: "opened", sequenceStepId: null }] })).toBe(false);
  });

  it("falls back to any earlier step when the chosen step is not earlier (reordered or from elsewhere)", () => {
    expect(met(step("s3", 2, "opened", "elsewhere"), ["s1", "s2"], [opened("s1")])).toBe(true);
  });

  it("is not met for an unknown condition value", () => {
    expect(met(step("s3", 2, "replied"), ["s1"], [opened("s1")])).toBe(false);
  });
});
