import type { Tables, TablesInsert, TablesUpdate } from "@/types/database.types";
import type { Client } from "./shared";
import { unwrap } from "./shared";

// No userId parameter: ownership is derived from sequence_id -> campaign_id
// via RLS.

export async function listSequenceSteps(supabase: Client, sequenceId: string) {
  const { data, error } = await supabase
    .from("sequence_steps")
    .select("*")
    .eq("sequence_id", sequenceId)
    .order("step_order", { ascending: true });
  if (error) throw error;
  return data;
}

export async function getSequenceStep(supabase: Client, id: string) {
  const result = await supabase.from("sequence_steps").select("*").eq("id", id).single();
  return unwrap<Tables<"sequence_steps">>(result);
}

export async function createSequenceStep(supabase: Client, values: TablesInsert<"sequence_steps">) {
  const result = await supabase.from("sequence_steps").insert(values).select("*").single();
  return unwrap<Tables<"sequence_steps">>(result);
}

export async function updateSequenceStep(supabase: Client, id: string, values: TablesUpdate<"sequence_steps">) {
  const result = await supabase.from("sequence_steps").update(values).eq("id", id).select("*").single();
  return unwrap<Tables<"sequence_steps">>(result);
}

export async function deleteSequenceStep(supabase: Client, id: string) {
  const { error } = await supabase.from("sequence_steps").delete().eq("id", id);
  if (error) throw error;
}
