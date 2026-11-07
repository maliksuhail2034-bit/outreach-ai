"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import {
  createLead,
  createLeadList,
  createLeadNote,
  deleteLeadNote,
  moveLeadsToList,
  setLeadsStatus,
  deleteAllLeads,
  deleteLead,
  deleteLeadList,
  deleteLeads,
  getLead,
  getUserOrganization,
  queueAllLeadsForVerification,
  queueLeadsForVerification,
  setLeadsTimezone,
  updateLead,
  updateLeadList,
} from "@/lib/db";
import { leadListSchema, type LeadListInput } from "@/lib/validations/lead-lists";
import {
  leadSchema,
  leadsTimezoneUpdateSchema,
  type LeadInput,
  type LeadsTimezoneUpdateInput,
} from "@/lib/validations/leads";
import { assertWithinLeadLimit, PlanLimitError } from "@/lib/billing/limits";
import type { ActionResult } from "@/lib/action-result";
import { verifyLead } from "@/lib/verification/verify";
import { checkRateLimit } from "@/lib/rate-limit/check-rate-limit";
import { isVerifiedPoolLead } from "@/lib/leads/display";
import { resolveBulkLeads } from "@/lib/leads/crm-filters";
import {
  bulkMoveToListSchema,
  bulkSetStatusSchema,
  leadNoteSchema,
  type BulkLeadTarget,
} from "@/lib/validations/crm-leads";

// Server Functions are reachable directly via POST regardless of which UI
// calls them, so re-validate here even though the client form (react-hook-
// form + the same zod schema) already validated this input.

export async function createLeadListAction(input: LeadListInput) {
  const parsed = leadListSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();

  await createLeadList(supabase, {
    user_id: user.id,
    name: parsed.name,
    description: parsed.description ? parsed.description : null,
  });

  revalidatePath("/leads");
}

export async function updateLeadListAction(id: string, input: LeadListInput) {
  const parsed = leadListSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();

  await updateLeadList(supabase, user.id, id, {
    name: parsed.name,
    description: parsed.description ? parsed.description : null,
  });

  revalidatePath("/leads");
}

export async function deleteLeadListAction(id: string) {
  const user = await requireUser();
  const supabase = await createClient();

  await deleteLeadList(supabase, user.id, id);

  revalidatePath("/leads");
}

// A plan limit is returned rather than thrown so the upgrade message reaches
// the user — see lib/action-result.ts.
export async function createLeadAction(input: LeadInput): Promise<ActionResult> {
  const parsed = leadSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();

  try {
    await assertWithinLeadLimit(supabase, user.id, user.email);
  } catch (error) {
    if (error instanceof PlanLimitError) return { ok: false, error: error.message };
    throw error;
  }

  try {
    await createLead(supabase, {
      user_id: user.id,
      list_id: parsed.listId ? parsed.listId : null,
      first_name: parsed.firstName ? parsed.firstName : null,
      last_name: parsed.lastName ? parsed.lastName : null,
      email: parsed.email.trim().toLowerCase(),
      company: parsed.company ? parsed.company : null,
      title: parsed.title ? parsed.title : null,
      ...(parsed.status ? { status: parsed.status } : {}),
      // Only written when sent, so a caller that doesn't manage the timezone
      // never clears it; "" means "use the campaign timezone" (null).
      ...(parsed.timezone !== undefined ? { timezone: parsed.timezone || null } : {}),
    });
  } catch (error) {
    // leads_user_email_key: adding an email the user already has is an
    // expected outcome, not a crash — thrown, it reached the form as a
    // generic "Couldn't add the lead".
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return { ok: false, error: "A lead with this email already exists." };
    }
    throw error;
  }

  revalidatePath("/leads");
  revalidatePath("/dashboard");
  return { ok: true, data: undefined };
}

export async function updateLeadAction(id: string, input: LeadInput) {
  const parsed = leadSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();
  const existing = await getLead(supabase, user.id, id);

  await updateLead(supabase, user.id, id, {
    list_id: parsed.listId ? parsed.listId : null,
    first_name: parsed.firstName ? parsed.firstName : null,
    last_name: parsed.lastName ? parsed.lastName : null,
    // A Polimatiq verified lead's address is fixed (and the database rejects
    // changing it), so the submitted value is ignored for those leads.
    ...(isVerifiedPoolLead(existing) ? {} : { email: parsed.email.trim().toLowerCase() }),
    company: parsed.company ? parsed.company : null,
    title: parsed.title ? parsed.title : null,
    ...(parsed.status ? { status: parsed.status } : {}),
    // Only written when sent, so a caller that doesn't manage the timezone
    // never clears it; "" means "use the campaign timezone" (null).
    ...(parsed.timezone !== undefined ? { timezone: parsed.timezone || null } : {}),
  });

  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
}

// Bulk "Set timezone" / "Use campaign timezone" (timezone: null) for the
// leads selected in the lead table. Scoped to the caller's own leads
// (user_id, plus RLS). Queued sends pick the new timezone up at the send
// worker's final window check, which schedules in the lead's own window.
export async function setLeadsTimezoneAction(input: LeadsTimezoneUpdateInput) {
  const parsed = leadsTimezoneUpdateSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();

  await setLeadsTimezone(supabase, user.id, parsed.ids, parsed.timezone);

  revalidatePath("/leads");
}

export async function deleteLeadAction(id: string) {
  const user = await requireUser();
  const supabase = await createClient();

  await deleteLead(supabase, user.id, id);

  revalidatePath("/leads");
  revalidatePath("/dashboard");
  revalidatePath(`/leads/${id}`);
}

export async function deleteLeadsAction(ids: string[]) {
  const user = await requireUser();
  const supabase = await createClient();

  await deleteLeads(supabase, user.id, ids);

  revalidatePath("/leads");
  revalidatePath("/dashboard");
}

export async function deleteAllLeadsAction() {
  const user = await requireUser();
  const supabase = await createClient();

  await deleteAllLeads(supabase, user.id);

  revalidatePath("/leads");
  revalidatePath("/dashboard");
}

// Synchronous single-lead verify, triggered by a direct "Verify" click —
// see lib/verification/verify.ts. Errors from the provider are caught and
// persisted onto the lead as verification_status = 'error' rather than
// thrown; this only throws if no provider key is connected at all (the
// same "throw before persisting anything" behavior as
// generateRecommendation's missing-key check).
export async function verifyLeadAction(id: string) {
  const user = await requireUser();
  const supabase = await createClient();
  const organization = await getUserOrganization(supabase, user);
  await checkRateLimit("verification:verify_single", organization.id);

  const lead = await getLead(supabase, user.id, id);
  // Pool leads arrive verified; their stored address is a placeholder.
  if (isVerifiedPoolLead(lead)) throw new Error("Verified leads from Polimatiq are already verified.");
  await verifyLead(supabase, user.id, organization.id, id, lead.email, "millionverifier");

  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
}

// Bulk verification never runs synchronously in-request (see ROADMAP.md /
// the Email Verification architecture review) — this only flips the
// selected leads to verification_status = 'pending' so the verify-leads
// cron worker (lib/verification/bulk-worker.ts) picks them up on its next
// pass, the same queue-then-claim shape campaign sends already use.
export async function queueLeadsVerificationAction(ids: string[]) {
  const user = await requireUser();
  const supabase = await createClient();
  const organization = await getUserOrganization(supabase, user);
  await checkRateLimit("verification:queue", organization.id);

  await queueLeadsForVerification(supabase, user.id, ids);

  revalidatePath("/leads");
}

export async function queueAllLeadsVerificationAction() {
  const user = await requireUser();
  const supabase = await createClient();
  const organization = await getUserOrganization(supabase, user);
  await checkRateLimit("verification:queue", organization.id);

  await queueAllLeadsForVerification(supabase, user.id);

  revalidatePath("/leads");
}

// --- CRM bulk actions and notes ---
//
// A bulk action applies to the ticked leads or to every lead matching the
// Leads page's filters (resolveBulkLeads, which reads only the caller's own
// leads). Returns how many leads it changed.

export async function moveLeadsToListAction(input: { target: BulkLeadTarget; listId: string }): Promise<ActionResult<{ count: number }>> {
  const parsed = bulkMoveToListSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();

  const leads = await resolveBulkLeads(supabase, user.id, parsed.target);
  if (leads.length === 0) return { ok: false, error: "No leads match. Nothing was moved." };
  // Moving a lead to another user's list is refused by leads_check_list_owner.
  await moveLeadsToList(supabase, user.id, leads.map((lead) => lead.id), parsed.listId || null);

  revalidatePath("/leads");
  return { ok: true, data: { count: leads.length } };
}

export async function setLeadsStatusAction(input: { target: BulkLeadTarget; status: string }): Promise<ActionResult<{ count: number }>> {
  const parsed = bulkSetStatusSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();

  const leads = await resolveBulkLeads(supabase, user.id, parsed.target);
  if (leads.length === 0) return { ok: false, error: "No leads match. Nothing was changed." };
  await setLeadsStatus(supabase, user.id, leads.map((lead) => lead.id), parsed.status);

  revalidatePath("/leads");
  // The lead detail page changes one lead's status through this too.
  if (leads.length === 1) revalidatePath(`/leads/${leads[0].id}`);
  return { ok: true, data: { count: leads.length } };
}

export async function addLeadNoteAction(leadId: string, input: { body: string }) {
  const parsed = leadNoteSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();

  // Ownership: getLead is scoped to the caller (the insert policy re-checks it).
  await getLead(supabase, user.id, leadId);
  await createLeadNote(supabase, user.id, leadId, parsed.body);

  revalidatePath(`/leads/${leadId}`);
}

export async function deleteLeadNoteAction(leadId: string, noteId: string) {
  const user = await requireUser();
  const supabase = await createClient();

  await deleteLeadNote(supabase, user.id, noteId);

  revalidatePath(`/leads/${leadId}`);
}
