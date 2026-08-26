// The operator's own organization — same id as
// lib/billing/resolve-plan.ts's INTERNAL_UNLIMITED_ORGANIZATION_ID. The
// warmup engine (lib/warmup/warmup-worker.ts) only ever runs cycles for
// this one organization: it is not a general product feature, and every
// entry point into the worker passes this constant to
// claim_due_warmup_sends() rather than iterating every organization.
// Hardcoded (not an env var, not a role/email check) so it can never apply
// to any other account, including future real ones — mirrors the exact
// reasoning resolve-plan.ts already documents for its own constant.
export const WARMUP_ENGINE_ORGANIZATION_ID = "7ef89392-80ba-4447-a7b7-ba642ff00a53";
