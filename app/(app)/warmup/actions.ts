"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import {
  createWarmupProfile,
  getMailbox,
  getUserOrganization,
  getWarmupProfileByMailbox,
  insertWarmupEvent,
  updateWarmupProfile,
} from "@/lib/db";
import { warmupSettingsSchema, type WarmupSettingsInput } from "@/lib/validations/warmup";
import { nextStageForStatusChange } from "@/lib/warmup/state-machine";
import { calculateWarmupScore } from "@/lib/warmup/scoring";
import type { WarmupProfileStatus, WarmupStage } from "@/lib/warmup/types";

// Server Functions are reachable directly via POST regardless of which UI
// calls them, so re-validate here even though the client form already did.

const DEFAULT_TARGET_DAILY_VOLUME = 30;
const DEFAULT_RAMP_UP_PERCENT = 20;

async function requireOwnedMailboxProfile(mailboxId: string) {
  const user = await requireUser();
  const supabase = await createClient();

  await getMailbox(supabase, user.id, mailboxId); // throws if not owned
  const organization = await getUserOrganization(supabase, user);
  const profile = await getWarmupProfileByMailbox(supabase, organization.id, mailboxId);

  return { supabase, organizationId: organization.id, profile };
}

// The single place that writes a status change (enable/pause/disable),
// including the settings a fresh 'enable' provides. Delegates the actual
// "what stage does this move to" decision to
// lib/warmup/state-machine.ts's nextStageForStatusChange and the resulting
// health score to lib/warmup/scoring.ts — this function is orchestration
// (auth, ownership, persistence), not business logic.
async function applyStatusChange(mailboxId: string, newStatus: WarmupProfileStatus, settings?: WarmupSettingsInput) {
  const { supabase, organizationId, profile } = await requireOwnedMailboxProfile(mailboxId);

  const currentStage: WarmupStage = (profile?.stage as WarmupStage | undefined) ?? "disabled";
  const nextStage = nextStageForStatusChange(currentStage, newStatus);
  const targetDailyVolume = settings?.targetDailyVolume ?? profile?.target_daily_volume ?? DEFAULT_TARGET_DAILY_VOLUME;
  const rampUpPercent = settings?.rampUpPercent ?? profile?.ramp_up_percent ?? DEFAULT_RAMP_UP_PERCENT;
  const currentDailyVolume = profile?.current_daily_volume ?? 0;
  const now = new Date().toISOString();

  const healthScore = calculateWarmupScore({ stage: nextStage, targetDailyVolume, currentDailyVolume });

  const saved = profile
    ? await updateWarmupProfile(supabase, organizationId, mailboxId, {
        status: newStatus,
        stage: nextStage,
        target_daily_volume: targetDailyVolume,
        ramp_up_percent: rampUpPercent,
        health_score: healthScore,
        started_at: profile.started_at ?? (newStatus === "enabled" ? now : null),
        last_activity_at: now,
      })
    : await createWarmupProfile(supabase, {
        organization_id: organizationId,
        mailbox_id: mailboxId,
        status: newStatus,
        stage: nextStage,
        target_daily_volume: targetDailyVolume,
        ramp_up_percent: rampUpPercent,
        health_score: healthScore,
        started_at: newStatus === "enabled" ? now : null,
        last_activity_at: now,
      });

  await insertWarmupEvent(supabase, {
    warmup_profile_id: saved.id,
    organization_id: organizationId,
    event_type: currentStage === nextStage ? "status_changed" : "stage_changed",
    detail: `${currentStage} -> ${nextStage} (status: ${newStatus})`,
  });

  revalidatePath("/warmup");
  revalidatePath("/settings/deliverability");
}

export async function enableWarmupAction(mailboxId: string, input: WarmupSettingsInput) {
  const parsed = warmupSettingsSchema.parse(input);
  await applyStatusChange(mailboxId, "enabled", parsed);
}

export async function pauseWarmupAction(mailboxId: string) {
  await applyStatusChange(mailboxId, "paused");
}

export async function disableWarmupAction(mailboxId: string) {
  await applyStatusChange(mailboxId, "disabled");
}

// Updates target volume / ramp-up speed without touching status or stage.
export async function updateWarmupSettingsAction(mailboxId: string, input: WarmupSettingsInput) {
  const parsed = warmupSettingsSchema.parse(input);
  const { supabase, organizationId, profile } = await requireOwnedMailboxProfile(mailboxId);
  if (!profile) {
    throw new Error("Enable warmup for this mailbox before changing its settings.");
  }

  const healthScore = calculateWarmupScore({
    stage: profile.stage as WarmupStage,
    targetDailyVolume: parsed.targetDailyVolume,
    currentDailyVolume: profile.current_daily_volume,
  });

  await updateWarmupProfile(supabase, organizationId, mailboxId, {
    target_daily_volume: parsed.targetDailyVolume,
    ramp_up_percent: parsed.rampUpPercent,
    health_score: healthScore,
  });

  await insertWarmupEvent(supabase, {
    warmup_profile_id: profile.id,
    organization_id: organizationId,
    event_type: "volume_adjusted",
    detail: `target_daily_volume -> ${parsed.targetDailyVolume}, ramp_up_percent -> ${parsed.rampUpPercent}`,
  });

  revalidatePath("/warmup");
}
