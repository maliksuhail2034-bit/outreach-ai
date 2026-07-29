"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { upsertProfile, upsertSettings } from "@/lib/db";
import { profileSchema, settingsSchema, type ProfileInput, type SettingsInput } from "@/lib/validations/settings";

// Server Functions are reachable directly via POST regardless of which UI
// calls them, so re-validate here even though the client form (react-hook-
// form + the same zod schema) already validated this input.

export async function updateProfile(input: ProfileInput) {
  const parsed = profileSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();

  await upsertProfile(supabase, user.id, {
    full_name: parsed.fullName,
    avatar_url: parsed.avatarUrl ? parsed.avatarUrl : null,
    timezone: parsed.timezone,
  });

  revalidatePath("/settings");
  revalidatePath("/dashboard");
}

export async function updateSettings(input: SettingsInput) {
  const parsed = settingsSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();

  await upsertSettings(supabase, user.id, {
    signature: parsed.signature ? parsed.signature : null,
    unsubscribe_text: parsed.unsubscribeText ? parsed.unsubscribeText : null,
    tracking_enabled: parsed.trackingEnabled,
    timezone: parsed.timezone,
  });

  revalidatePath("/settings");
}
