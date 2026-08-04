"use server";

import { revalidatePath } from "next/cache";
import type { User } from "@supabase/supabase-js";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import type { Client } from "@/lib/db";
import {
  createLead,
  createLeadList,
  deleteAllLeads,
  deleteLead,
  deleteLeadList,
  deleteLeads,
  getLead,
  getOrCreateOrganizationForUser,
  queueAllLeadsForVerification,
  queueLeadsForVerification,
  updateLead,
  updateLeadList,
} from "@/lib/db";
import { leadListSchema, type LeadListInput } from "@/lib/validations/lead-lists";
import { leadSchema, type LeadInput } from "@/lib/validations/leads";
import { assertWithinLeadLimit } from "@/lib/billing/limits";
import { verifyLead } from "@/lib/verification/verify";

// Same resolution as app/(app)/settings/ai/actions.ts's getUserOrganization
// — leads stays user_id-scoped (see CLAUDE.md/leads migration), but the
// connected verification provider key is organization-scoped like
// ai_provider_keys, so verifying a lead needs both ids.
async function getUserOrganization(supabase: Client, user: User) {
  const namePrefix = user.email?.split("@")[0]?.trim();
  return getOrCreateOrganizationForUser(supabase, user.id, `${namePrefix || "My"}'s workspace`);
}

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

export async function createLeadAction(input: LeadInput) {
  const parsed = leadSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();

  await assertWithinLeadLimit(supabase, user.id, user.email);

  await createLead(supabase, {
    user_id: user.id,
    list_id: parsed.listId ? parsed.listId : null,
    first_name: parsed.firstName ? parsed.firstName : null,
    last_name: parsed.lastName ? parsed.lastName : null,
    email: parsed.email.trim().toLowerCase(),
    company: parsed.company ? parsed.company : null,
    title: parsed.title ? parsed.title : null,
    ...(parsed.status ? { status: parsed.status } : {}),
  });

  revalidatePath("/leads");
  revalidatePath("/dashboard");
}

export async function updateLeadAction(id: string, input: LeadInput) {
  const parsed = leadSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();

  await updateLead(supabase, user.id, id, {
    list_id: parsed.listId ? parsed.listId : null,
    first_name: parsed.firstName ? parsed.firstName : null,
    last_name: parsed.lastName ? parsed.lastName : null,
    email: parsed.email.trim().toLowerCase(),
    company: parsed.company ? parsed.company : null,
    title: parsed.title ? parsed.title : null,
    ...(parsed.status ? { status: parsed.status } : {}),
  });

  revalidatePath("/leads");
}

export async function deleteLeadAction(id: string) {
  const user = await requireUser();
  const supabase = await createClient();

  await deleteLead(supabase, user.id, id);

  revalidatePath("/leads");
  revalidatePath("/dashboard");
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

  const lead = await getLead(supabase, user.id, id);
  await verifyLead(supabase, user.id, organization.id, id, lead.email, "millionverifier");

  revalidatePath("/leads");
}

// Bulk verification never runs synchronously in-request (see ROADMAP.md /
// the Email Verification architecture review) — this only flips the
// selected leads to verification_status = 'pending' so the verify-leads
// cron worker (lib/verification/bulk-worker.ts) picks them up on its next
// pass, the same queue-then-claim shape campaign sends already use.
export async function queueLeadsVerificationAction(ids: string[]) {
  const user = await requireUser();
  const supabase = await createClient();

  await queueLeadsForVerification(supabase, user.id, ids);

  revalidatePath("/leads");
}

export async function queueAllLeadsVerificationAction() {
  const user = await requireUser();
  const supabase = await createClient();

  await queueAllLeadsForVerification(supabase, user.id);

  revalidatePath("/leads");
}
