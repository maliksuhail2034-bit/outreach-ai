import type { Tables, TablesInsert } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

// email_attachments has its own user_id column (unlike sequence_steps, which
// derives ownership through sequence_id -> campaign_id) — see
// supabase/migrations/20260917100000_email_attachments.sql. Every function
// here takes userId explicitly and filters on it even though RLS already
// enforces the same thing for the normal (session-scoped) client: send-worker.ts
// calls these with the admin client, which bypasses RLS entirely, so the
// explicit .eq("user_id", ...) below is the only thing actually scoping that
// caller — never remove it on the assumption RLS already covers it.

export async function createAttachment(supabase: Client, values: TablesInsert<"email_attachments">) {
  const result = await supabase.from("email_attachments").insert(values).select("*").single();
  return unwrap<Tables<"email_attachments">>(result);
}

export async function getAttachment(supabase: Client, userId: string, id: string) {
  const result = await supabase
    .from("email_attachments")
    .select("*")
    .eq("user_id", userId)
    .eq("id", id)
    .single();
  return unwrap<Tables<"email_attachments">>(result);
}

// Composer-side read (sequence-step-form/sequence-steps-panel/campaign-review-step) —
// always called with the session-scoped client, so RLS alone already limits
// this to the caller's own attachments; no explicit userId needed here.
export async function listAttachmentsForStep(supabase: Client, sequenceStepId: string) {
  const { data, error } = await supabase
    .from("email_attachments")
    .select("*")
    .eq("sequence_step_id", sequenceStepId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

// Same as listAttachmentsForStep but for every step on a campaign's sequence
// in one query — used by the campaign detail page (page.tsx) to preload
// attachments for the whole Sequence/Review UI without one round trip per
// step. Still session-scoped (RLS), so this is purely a batching
// optimization, not a scoping change.
export async function listAttachmentsForSteps(supabase: Client, sequenceStepIds: string[]) {
  if (sequenceStepIds.length === 0) return [];
  const { data, error } = await supabase
    .from("email_attachments")
    .select("*")
    .in("sequence_step_id", sequenceStepIds)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

// Send-worker's read: called with the admin client (no RLS), so ownership is
// enforced here instead — both sequence_step_id AND user_id must match, so a
// data-integrity bug that somehow links a step to the wrong owner's
// attachment could never cause someone else's file to go out on this send.
export async function listAttachmentsForStepScoped(supabase: Client, sequenceStepId: string, userId: string) {
  const { data, error } = await supabase
    .from("email_attachments")
    .select("*")
    .eq("sequence_step_id", sequenceStepId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

// Fetches only the rows among `ids` that the caller actually owns — used
// both to verify a set of attachment ids before linking them to a step
// (linkAttachmentsToStepAction) and to look up storage_path before deleting
// (deleteAttachmentAction/discardUnlinkedAttachmentsAction). Any id in the
// input that isn't the caller's own (or doesn't exist) is silently absent
// from the result rather than erroring — callers treat "fewer rows came
// back than ids requested" as the ownership/existence check itself.
export async function listOwnedAttachmentsByIds(supabase: Client, userId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("email_attachments")
    .select("*")
    .eq("user_id", userId)
    .in("id", ids);
  if (error) throw error;
  return data;
}

export async function linkAttachmentsToStep(supabase: Client, userId: string, ids: string[], sequenceStepId: string) {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from("email_attachments")
    .update({ sequence_step_id: sequenceStepId })
    .eq("user_id", userId)
    .in("id", ids);
  if (error) throw error;
}

// Unlinks whatever attachments are currently on a step but not in
// `keepIds` — used when saving a step so a removed-then-unsaved attachment
// (already hard-deleted by removeAttachmentAction, see the composer) isn't
// the only way a step's attachment set can shrink; this covers the general
// case defensively. Deletes the row outright rather than just clearing
// sequence_step_id: an unlinked attachment nobody references is dead
// weight, not a draft worth keeping around (see the "unlinked" case
// docstring on discardUnlinkedAttachmentsAction for the same reasoning).
export async function deleteAttachments(supabase: Client, userId: string, ids: string[]) {
  if (ids.length === 0) return;
  const { error } = await supabase.from("email_attachments").delete().eq("user_id", userId).in("id", ids);
  if (error) throw error;
}
