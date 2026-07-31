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
