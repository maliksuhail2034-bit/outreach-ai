"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { revokeMySession } from "@/lib/db";

// Server Functions are reachable directly via POST regardless of which UI
// calls them, so each re-checks the session itself. revoke_my_session is
// additionally scoped to auth.uid() in the database.

export async function revokeSessionAction(sessionId: string) {
  const id = z.uuid().parse(sessionId);
  await requireUser();
  const supabase = await createClient();

  if (!(await revokeMySession(supabase, id))) {
    throw new Error("Session not found.");
  }

  revalidatePath("/settings/sessions");
}

// Ends every session of this account, this browser's included.
export async function signOutAllSessionsAction() {
  await requireUser();
  const supabase = await createClient();

  const { error } = await supabase.auth.signOut({ scope: "global" });
  if (error) throw error;

  redirect("/login");
}
