import type { TablesInsert } from "@/types/database.types";
import type { Client } from "./shared";

// Deliberately does NOT follow this directory's usual "throw on error"
// convention — every other lib/db/*.ts function throws so a caller can react
// to a failure, but an audit log write failing must never be allowed to
// block the user action it's recording (Phase 3B Part 2 requirement).
// Swallows and logs instead of throwing, so every call site can simply
// `await recordAuditEvent(...)` with no `.catch()` of its own — "best-effort"
// is guaranteed by this one function, not by remembering to wrap every one
// of its ~13 call sites correctly.
//
// The single centralized writer for public.audit_logs — every caller across
// mailboxes/settings/billing goes through this function, never inserts into
// the table directly. `values.metadata` must never contain a secret (see the
// migration's column comment) — this function doesn't validate that itself,
// callers are responsible for only passing already-safe-to-display data
// (email addresses, provider names, masked key previews).
export async function recordAuditEvent(supabase: Client, values: TablesInsert<"audit_logs">): Promise<void> {
  const { error } = await supabase.from("audit_logs").insert(values);
  if (error) {
    console.error("[audit-log] failed to record event", values.action, error);
  }
}
