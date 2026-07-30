"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createCampaign, deleteCampaign, updateCampaign } from "@/lib/db";
import { campaignSchema, type CampaignInput } from "@/lib/validations/campaigns";

// Server Functions are reachable directly via POST regardless of which UI
// calls them, so re-validate here even though the client form (react-hook-
// form + the same zod schema) already validated this input.

export async function createCampaignAction(input: CampaignInput) {
  const parsed = campaignSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();

  await createCampaign(supabase, {
    user_id: user.id,
    name: parsed.name,
    daily_limit: parsed.dailyLimit,
    default_mailbox_id: parsed.defaultMailboxId ? parsed.defaultMailboxId : null,
    sending_window: parsed.sendingWindow,
    ...(parsed.status ? { status: parsed.status } : {}),
  });

  revalidatePath("/campaigns");
}

export async function updateCampaignAction(id: string, input: CampaignInput) {
  const parsed = campaignSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();

  await updateCampaign(supabase, user.id, id, {
    name: parsed.name,
    daily_limit: parsed.dailyLimit,
    default_mailbox_id: parsed.defaultMailboxId ? parsed.defaultMailboxId : null,
    sending_window: parsed.sendingWindow,
    ...(parsed.status ? { status: parsed.status } : {}),
  });

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
}

export async function deleteCampaignAction(id: string) {
  const user = await requireUser();
  const supabase = await createClient();

  await deleteCampaign(supabase, user.id, id);

  revalidatePath("/campaigns");
}
