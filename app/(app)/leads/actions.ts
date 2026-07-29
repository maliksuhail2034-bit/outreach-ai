"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import {
  createLead,
  createLeadList,
  deleteLead,
  deleteLeadList,
  updateLead,
  updateLeadList,
} from "@/lib/db";
import { leadListSchema, type LeadListInput } from "@/lib/validations/lead-lists";
import { leadSchema, type LeadInput } from "@/lib/validations/leads";

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
