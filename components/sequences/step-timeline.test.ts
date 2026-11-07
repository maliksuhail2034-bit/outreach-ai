import { describe, expect, it } from "vitest";
import { computeStepDays, conditionWarning, describeCondition, type TimelineStep } from "./step-timeline";

function step(id: string, order: number, dayDelay: number, condition = "always", conditionStepId: string | null = null): TimelineStep {
  return { id, step_order: order, day_delay: dayDelay, condition, condition_step_id: conditionStepId };
}

describe("computeStepDays", () => {
  it("puts the first step on day 1 and adds each delay in turn", () => {
    const days = computeStepDays([step("a", 0, 0), step("b", 1, 3), step("c", 2, 4)]);
    expect([...days.entries()]).toEqual([
      ["a", 1],
      ["b", 4],
      ["c", 8],
    ]);
  });

  it("puts alternative branches (opened / didn't open the same step) on the same day", () => {
    const days = computeStepDays([
      step("one", 0, 0),
      step("opened", 1, 3, "opened", "one"),
      step("unopened", 2, 3, "not_opened", "one"),
      step("after", 3, 4),
    ]);
    expect(days.get("opened")).toBe(4);
    expect(days.get("unopened")).toBe(4);
    expect(days.get("after")).toBe(8);
  });

  it("chains non-exclusive conditional steps normally", () => {
    const days = computeStepDays([step("one", 0, 0), step("opened", 1, 2, "opened", "one"), step("clicked", 2, 2, "not_clicked", "one")]);
    expect(days.get("clicked")).toBe(5);
  });

  it("orders by step_order, not array order", () => {
    const days = computeStepDays([step("b", 1, 2), step("a", 0, 1)]);
    expect(days.get("a")).toBe(2);
    expect(days.get("b")).toBe(4);
  });
});

describe("describeCondition", () => {
  const numbers = new Map([
    ["one", 1],
    ["two", 2],
  ]);

  it("names the step, or any earlier email", () => {
    expect(describeCondition(step("x", 2, 1, "not_opened", "two"), numbers)).toBe("Only if they didn't open step 2");
    expect(describeCondition(step("x", 2, 1, "clicked"), numbers)).toBe("Only if they clicked a link in any earlier email");
  });

  it("returns null for an unconditional step", () => {
    expect(describeCondition(step("x", 2, 1), numbers)).toBeNull();
  });
});

describe("conditionWarning", () => {
  it("flags a condition on the first step and one pointing at a later step", () => {
    const first = step("one", 0, 0, "opened");
    const later = step("two", 1, 2, "opened", "three");
    const steps = [first, later, step("three", 2, 2)];
    expect(conditionWarning(first, steps)).toMatch(/first email/);
    expect(conditionWarning(later, steps)).toMatch(/later step/);
    expect(conditionWarning(step("ok", 3, 1, "opened", "one"), steps)).toBeNull();
  });
});
