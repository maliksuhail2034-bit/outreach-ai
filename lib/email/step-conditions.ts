// Whether a sequence step's condition (sequence_steps.condition /
// condition_step_id) is met for one lead, from what that lead was actually
// sent and how a person (not a bot, email_events.is_bot) engaged with it.
// Pure, so the send worker and the tests share one definition.
//
// A condition is about the lead's reaction to an email they received, so
// only steps actually sent to them count: a condition on a step they were
// never sent (skipped by its own condition) is not met either way, and
// "any earlier step" (condition_step_id null) means any earlier step they
// were sent. A click implies an open (images blocked), also for events
// recorded before clicks started recording an inferred open.

export const STEP_CONDITIONS = ["always", "opened", "not_opened", "clicked", "not_clicked"] as const;
export type StepCondition = (typeof STEP_CONDITIONS)[number];

export function isStepCondition(value: unknown): value is StepCondition {
  return typeof value === "string" && (STEP_CONDITIONS as readonly string[]).includes(value);
}

export interface ConditionalStep {
  id: string;
  step_order: number;
  condition: string;
  condition_step_id: string | null;
}

export interface StepEngagement {
  eventType: "opened" | "clicked";
  sequenceStepId: string | null;
}

export function isStepConditionMet(params: {
  step: ConditionalStep;
  steps: ConditionalStep[];
  sentStepIds: ReadonlySet<string>;
  engagement: StepEngagement[];
}): boolean {
  const { step, steps, sentStepIds, engagement } = params;
  if (!isStepCondition(step.condition)) return false;
  if (step.condition === "always") return true;

  const earlier = steps.filter((candidate) => candidate.step_order < step.step_order);
  const chosen = step.condition_step_id ? earlier.find((candidate) => candidate.id === step.condition_step_id) : undefined;
  // A chosen step that isn't earlier in this sequence (moved below this
  // step, or deleted) falls back to "any earlier step".
  const referenced = (chosen ? [chosen] : earlier).filter((candidate) => sentStepIds.has(candidate.id));
  if (referenced.length === 0) return false;

  const referencedIds = new Set(referenced.map((candidate) => candidate.id));
  const opened = new Set<string>();
  const clicked = new Set<string>();
  for (const event of engagement) {
    if (!event.sequenceStepId || !referencedIds.has(event.sequenceStepId)) continue;
    opened.add(event.sequenceStepId);
    if (event.eventType === "clicked") clicked.add(event.sequenceStepId);
  }

  switch (step.condition) {
    case "opened":
      return opened.size > 0;
    case "not_opened":
      return opened.size === 0;
    case "clicked":
      return clicked.size > 0;
    case "not_clicked":
      return clicked.size === 0;
  }
}
