// Shared types for the Mailbox Warmup Foundation — profile configuration,
// the stage state machine, scheduling, and scoring. See state-machine.ts
// for stage transition rules and scoring.ts for how these combine into a
// warmup score.

// The user-facing on/off control (mirrors mailboxes.status's active/
// paused/error shape) — distinct from `stage`, which is where the state
// machine currently sits while enabled. A profile can be 'enabled' and
// still be in the 'starting' stage; disabling always drives the stage back
// to 'disabled' (see state-machine.ts).
export type WarmupProfileStatus = "enabled" | "paused" | "disabled";

// The state machine's positions: Disabled -> Starting -> Warming ->
// Healthy -> Cooling -> Paused, and back to Disabled — see
// state-machine.ts for the full transition graph.
export type WarmupStage = "disabled" | "starting" | "warming" | "healthy" | "cooling" | "paused";

// warmup_events.event_type — append-only audit log entries.
export type WarmupEventType = "status_changed" | "stage_changed" | "volume_adjusted" | "warning";
