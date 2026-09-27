"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import type { Client } from "@/lib/db/shared";
import { createLeadSegment, deleteLeadSegment, listLeadLists, updateLeadSegment } from "@/lib/db";
import { leadSegmentSchema, referencedListIds, type LeadSegmentInput, type LeadSegmentRule } from "@/lib/validations/lead-segments";

// Server Functions are reachable directly via POST regardless of which UI
// calls them, so every action re-validates the whole segment (same schema
// the form uses) and re-checks ownership itself: the segment row is scoped
// to the caller by user_id (plus RLS), and any list a rule names must be one
// of the caller's own lists (plus the check_lead_segment_list_owner trigger).

async function assertOwnsReferencedLists(supabase: Client, userId: string, rules: readonly LeadSegmentRule[]) {
  const listIds = referencedListIds(rules);
  if (listIds.length === 0) return;
  const ownListIds = new Set((await listLeadLists(supabase, userId)).map((list) => list.id));
  if (listIds.some((id) => !ownListIds.has(id))) {
    throw new Error("A segment can only use your own lead lists.");
  }
}

export async function createLeadSegmentAction(input: LeadSegmentInput) {
  const parsed = leadSegmentSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();

  await assertOwnsReferencedLists(supabase, user.id, parsed.rules);
  await createLeadSegment(supabase, {
    user_id: user.id,
    name: parsed.name,
    description: parsed.description ? parsed.description : null,
    rules: parsed.rules,
  });

  revalidatePath("/leads");
}

export async function updateLeadSegmentAction(id: string, input: LeadSegmentInput) {
  const parsed = leadSegmentSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();

  await assertOwnsReferencedLists(supabase, user.id, parsed.rules);
  await updateLeadSegment(supabase, user.id, id, {
    name: parsed.name,
    description: parsed.description ? parsed.description : null,
    rules: parsed.rules,
  });

  revalidatePath("/leads");
}

export async function deleteLeadSegmentAction(id: string) {
  const user = await requireUser();
  const supabase = await createClient();

  await deleteLeadSegment(supabase, user.id, id);

  revalidatePath("/leads");
}
