import type { User } from "@supabase/supabase-js";
import type { Tables, TablesInsert } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

// Membership, not organizations.owner_user_id, is the source of truth for
// "does this user belong to this org" — see the migration's comment for why.
export async function getOrganizationMembership(supabase: Client, userId: string) {
  const { data, error } = await supabase
    .from("organization_members")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getOrganization(supabase: Client, id: string) {
  const result = await supabase.from("organizations").select("*").eq("id", id).single();
  return unwrap<Tables<"organizations">>(result);
}

export async function createOrganization(supabase: Client, values: TablesInsert<"organizations">) {
  const result = await supabase.from("organizations").insert(values).select("*").single();
  return unwrap<Tables<"organizations">>(result);
}

export async function addOrganizationMember(supabase: Client, values: TablesInsert<"organization_members">) {
  const result = await supabase.from("organization_members").insert(values).select("*").single();
  return unwrap<Tables<"organization_members">>(result);
}

// Lazy provisioning, same shape as getOrCreateDefaultSequence
// (lib/db/sequences.ts): almost every user already has a personal
// organization from the migration's backfill. This only creates one for a
// user who doesn't yet — e.g. a signup after the migration ran, since
// there's no auth.users trigger (see the migration for why).
export async function getOrCreateOrganizationForUser(
  supabase: Client,
  userId: string,
  defaultName: string,
): Promise<Tables<"organizations">> {
  const membership = await getOrganizationMembership(supabase, userId);
  if (membership) return getOrganization(supabase, membership.organization_id);

  const organization = await createOrganization(supabase, { owner_user_id: userId, name: defaultName });
  await addOrganizationMember(supabase, { organization_id: organization.id, user_id: userId });
  return organization;
}

// Shared org-resolution helper for every Server Function/Server Component
// that needs "the current user's organization" — derives the same default
// workspace name (email local-part + "'s workspace") every caller used to
// derive independently. Wraps getOrCreateOrganizationForUser above; see it
// for the actual lazy-provisioning logic. Takes only id/email (not the full
// Supabase User) so callers that only have those two fields on hand — e.g.
// lib/billing/limits.ts, which takes userId/userEmail rather than a User
// object — can use it too without constructing a fake User.
export function getUserOrganization(supabase: Client, user: Pick<User, "id" | "email">) {
  const namePrefix = user.email?.split("@")[0]?.trim();
  return getOrCreateOrganizationForUser(supabase, user.id, `${namePrefix || "My"}'s workspace`);
}
