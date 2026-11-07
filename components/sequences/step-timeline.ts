import type { StepCondition } from "@/lib/email/step-conditions";

// The sequence editor's day-by-day view. A step is sent `day_delay` days
// after the last email actually sent to the lead (lib/email/send-worker.ts,
// skipStepIfConditionUnmet), so a step's day follows the nearest earlier
// step the same lead can also have received. Two steps with opposite
// conditions on the same email ("opened step 1" / "didn't open step 1") never
// both reach one lead, so the second one's day follows whatever came before
// the first — that's what puts alternative branches on the same day.

export interface TimelineStep {
  id: string;
  step_order: number;
  day_delay: number;
  condition: string;
  condition_step_id: string | null;
}

const OPPOSITE: Partial<Record<string, StepCondition>> = {
  opened: "not_opened",
  not_opened: "opened",
  clicked: "not_clicked",
  not_clicked: "clicked",
};

function mutuallyExclusive(a: TimelineStep, b: TimelineStep): boolean {
  return OPPOSITE[a.condition] === b.condition && a.condition_step_id === b.condition_step_id;
}

// Day numbers start at 1: the first step goes out on day 1.
export function computeStepDays(steps: TimelineStep[]): Map<string, number> {
  const sorted = [...steps].sort((a, b) => a.step_order - b.step_order);
  const days = new Map<string, number>();
  sorted.forEach((step, index) => {
    if (index === 0) {
      days.set(step.id, 1 + step.day_delay);
      return;
    }
    let previous: TimelineStep | undefined;
    for (let j = index - 1; j >= 0; j--) {
      if (!mutuallyExclusive(step, sorted[j])) {
        previous = sorted[j];
        break;
      }
    }
    const base = previous ? (days.get(previous.id) ?? 1) : 1;
    days.set(step.id, base + step.day_delay);
  });
  return days;
}

const CONDITION_VERB: Record<Exclude<StepCondition, "always">, string> = {
  opened: "opened",
  not_opened: "didn't open",
  clicked: "clicked a link in",
  not_clicked: "didn't click a link in",
};

export const CONDITION_OPTIONS: { value: StepCondition; label: string }[] = [
  { value: "always", label: "Always" },
  { value: "opened", label: "Only if they opened" },
  { value: "not_opened", label: "Only if they didn't open" },
  { value: "clicked", label: "Only if they clicked a link in" },
  { value: "not_clicked", label: "Only if they didn't click a link in" },
];

// "Only if they opened step 1", or null for an unconditional step.
export function describeCondition(step: TimelineStep, stepNumbers: Map<string, number>): string | null {
  if (step.condition === "always" || !(step.condition in CONDITION_VERB)) return null;
  const verb = CONDITION_VERB[step.condition as Exclude<StepCondition, "always">];
  const number = step.condition_step_id ? stepNumbers.get(step.condition_step_id) : undefined;
  return `Only if they ${verb} ${number ? `step ${number}` : "any earlier email"}`;
}

// Problems the editor shows on a step: a condition on the first step (it is
// skipped, nothing came before it), or on a step that now comes after this
// one (counted as "any earlier email").
export function conditionWarning(step: TimelineStep, steps: TimelineStep[]): string | null {
  if (step.condition === "always") return null;
  const earlier = steps.filter((other) => other.step_order < step.step_order);
  if (earlier.length === 0) return "The first email has nothing before it to react to, so this condition is never met. Set it to Always.";
  if (step.condition_step_id && !earlier.some((other) => other.id === step.condition_step_id)) {
    return "This condition refers to a later step, so it counts as any earlier email. Edit the step to choose again.";
  }
  return null;
}
