import type { Tables } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

// Notes on a lead (CRM). RLS scopes every row to its author, and inserting
// requires owning the lead (lead_notes policies).

export async function listLeadNotes(supabase: Client, userId: string, leadId: string) {
  const { data, error } = await supabase
    .from("lead_notes")
    .select("*")
    .eq("user_id", userId)
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data;
}

export async function createLeadNote(supabase: Client, userId: string, leadId: string, body: string) {
  const result = await supabase.from("lead_notes").insert({ user_id: userId, lead_id: leadId, body }).select("*").single();
  return unwrap<Tables<"lead_notes">>(result);
}

export async function deleteLeadNote(supabase: Client, userId: string, noteId: string) {
  const { error } = await supabase.from("lead_notes").delete().eq("user_id", userId).eq("id", noteId);
  if (error) throw error;
}
