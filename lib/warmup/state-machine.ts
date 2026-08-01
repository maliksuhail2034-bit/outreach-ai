import type { WarmupProfileStatus, WarmupStage } from "./types";

// The full stage graph: Disabled -> Starting -> Warming -> Healthy ->
// Cooling -> Paused, and back to Disabled. 'disabled' is reachable from
// every stage (a universal escape hatch — disabling always works
// regardless of progress) and 'paused' is reachable from every active
// stage. Only a subset of these edges is exercised by anything in this
// phase (see nextStageForStatusChange below) — the rest exist so a future
// automatic scheduler (see ../scheduler.ts) can advance stages without a
// schema or state-machine change, per Task 6's future-compatibility scope.
const VALID_TRANSITIONS: Record<WarmupStage, WarmupStage[]> = {
  disabled: ["starting"],
  starting: ["warming", "paused", "disabled"],
  warming: ["healthy", "cooling", "paused", "disabled"],
  healthy: ["cooling", "paused", "disabled"],
  cooling: ["warming", "healthy", "paused", "disabled"],
  paused: ["starting", "warming", "disabled"],
};

export function canTransition(from: WarmupStage, to: WarmupStage): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export class InvalidWarmupTransitionError extends Error {
  constructor(from: WarmupStage, to: WarmupStage) {
    super(`Cannot transition warmup stage from '${from}' to '${to}'.`);
  }
}

export function transition(from: WarmupStage, to: WarmupStage): WarmupStage {
  if (!canTransition(from, to)) throw new InvalidWarmupTransitionError(from, to);
  return to;
}

// The only stage-transition policy this phase actually drives: a user
// flipping a profile's status (enable/pause/disable) — see
// app/(app)/warmup/actions.ts. Enabling from 'disabled' starts the ramp at
// 'starting'; resuming from 'paused' picks back up at 'warming' rather than
// restarting from scratch. Enabling a profile that's already mid-flow
// (starting/warming/healthy/cooling) leaves its stage untouched. Idempotent
// — calling this with a status that doesn't change the target stage (e.g.
// disabling an already-disabled profile) returns the current stage without
// consulting the transition table, so repeat clicks never throw.
export function nextStageForStatusChange(currentStage: WarmupStage, newStatus: WarmupProfileStatus): WarmupStage {
  const target: WarmupStage =
    newStatus === "disabled"
      ? "disabled"
      : newStatus === "paused"
        ? "paused"
        : currentStage === "disabled"
          ? "starting"
          : currentStage === "paused"
            ? "warming"
            : currentStage;

  if (target === currentStage) return currentStage;
  return transition(currentStage, target);
}
