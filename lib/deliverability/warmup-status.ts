import type { WarmupStage } from "@/lib/warmup/types";
import type { WarmupStatus } from "./types";

// Bridges lib/warmup's richer 6-stage state machine down to
// lib/deliverability's simpler WarmupStatus, so Mailbox Health's scoring
// (which predates warmup_profiles) understands warmup progress without its
// own signature changing — see calculateMailboxHealthScore. Shared by the
// manual recalculate action (settings/deliverability/actions.ts) and the
// automated health-check worker (lib/deliverability/health-check-worker.ts)
// so the mapping only lives in one place.
export const STAGE_TO_DELIVERABILITY_STATUS: Record<WarmupStage, WarmupStatus> = {
  disabled: "not_started",
  starting: "warming",
  warming: "warming",
  healthy: "warmed",
  cooling: "warming",
  paused: "paused",
};
