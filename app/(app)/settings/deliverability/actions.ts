"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import {
  createDomain,
  deleteDomain,
  getDomain,
  getMailbox,
  getMailboxHealth,
  getOrCreateOrganizationForUser,
  getWarmupProfileByMailbox,
  insertDomainDnsCheck,
  updateDomain,
  upsertMailboxHealth,
} from "@/lib/db";
import { domainSchema, type DomainInput } from "@/lib/validations/deliverability";
import { getDnsProvider } from "@/lib/deliverability/get-dns-provider";
import { calculateDomainHealthScore, calculateMailboxHealthScore } from "@/lib/deliverability/scoring";
import type { DnsRecordType, WarmupStatus } from "@/lib/deliverability/types";
import type { WarmupStage } from "@/lib/warmup/types";

// Bridges lib/warmup's richer 6-stage state machine down to
// lib/deliverability's simpler WarmupStatus, so Mailbox Health's scoring
// (which predates warmup_profiles) understands warmup progress without
// its own signature changing — see calculateMailboxHealthScore.
const STAGE_TO_DELIVERABILITY_STATUS: Record<WarmupStage, WarmupStatus> = {
  disabled: "not_started",
  starting: "warming",
  warming: "warming",
  healthy: "warmed",
  cooling: "warming",
  paused: "paused",
};

// Server Functions are reachable directly via POST regardless of which UI
// calls them, so re-validate here even though the client form already did.

export async function createDomainAction(input: DomainInput) {
  const parsed = domainSchema.parse(input);
  const user = await requireUser();
  const supabase = await createClient();

  await createDomain(supabase, { user_id: user.id, domain: parsed.domain });

  revalidatePath("/settings/deliverability");
}

export async function deleteDomainAction(id: string) {
  const user = await requireUser();
  const supabase = await createClient();

  await deleteDomain(supabase, user.id, id);

  revalidatePath("/settings/deliverability");
}

// Runs the configured DnsProvider against a domain and persists the result
// — both the individual check rows (domain_dns_checks, an append-only log)
// and the summary shown on the Domain Health list (domains.*_verified,
// health_score, last_checked_at). getDnsProvider() returns a placeholder
// today (see lib/deliverability/dns-providers/placeholder.ts); swapping in
// a live provider later changes nothing here.
export async function runDomainDnsCheckAction(domainId: string) {
  const user = await requireUser();
  const supabase = await createClient();

  const domain = await getDomain(supabase, user.id, domainId); // throws if not owned
  const results = await getDnsProvider().verifyDomain(domain.domain);

  await Promise.all(
    results.map((result) =>
      insertDomainDnsCheck(supabase, {
        domain_id: domain.id,
        user_id: user.id,
        record_type: result.recordType,
        status: result.status,
        detail: result.detail,
      }),
    ),
  );

  const passed = (recordType: DnsRecordType) => results.find((r) => r.recordType === recordType)?.status === "pass";
  const spfVerified = passed("spf");
  const dkimVerified = passed("dkim");
  const dmarcVerified = passed("dmarc");
  const mxVerified = passed("mx");
  const healthScore = calculateDomainHealthScore({ spfVerified, dkimVerified, dmarcVerified, mxVerified });

  await updateDomain(supabase, user.id, domain.id, {
    spf_verified: spfVerified,
    dkim_verified: dkimVerified,
    dmarc_verified: dmarcVerified,
    mx_verified: mxVerified,
    health_score: healthScore,
    last_checked_at: new Date().toISOString(),
    status: spfVerified && dkimVerified && dmarcVerified && mxVerified ? "verified" : "pending",
  });

  revalidatePath("/settings/deliverability");
}

// Recalculates a mailbox's health score from whatever's currently stored.
// Reputation/bounce/reply data still isn't populated by any pipeline (that
// remains a future integration), but warmup status now comes from
// warmup_profiles when a profile exists — see Task 6's "Mailbox Health
// should now understand warmup status/score/stage" requirement — falling
// back to mailbox_health.warmup_status exactly as before for a mailbox
// that was never enrolled in warmup.
export async function recalculateMailboxHealthAction(mailboxId: string) {
  const user = await requireUser();
  const supabase = await createClient();

  await getMailbox(supabase, user.id, mailboxId); // throws if not owned
  const existing = await getMailboxHealth(supabase, user.id, mailboxId);

  const namePrefix = user.email?.split("@")[0]?.trim();
  const organization = await getOrCreateOrganizationForUser(supabase, user.id, `${namePrefix || "My"}'s workspace`);
  const warmupProfile = await getWarmupProfileByMailbox(supabase, organization.id, mailboxId);

  const warmupStatus = warmupProfile
    ? STAGE_TO_DELIVERABILITY_STATUS[warmupProfile.stage as WarmupStage]
    : ((existing?.warmup_status ?? "not_started") as WarmupStatus);

  const healthScore = calculateMailboxHealthScore({
    warmupStatus,
    reputationScore: existing?.reputation_score ?? null,
    bounceRate: existing?.bounce_rate ?? null,
    replyRate: existing?.reply_rate ?? null,
  });

  await upsertMailboxHealth(supabase, {
    mailbox_id: mailboxId,
    user_id: user.id,
    warmup_status: warmupStatus,
    reputation_score: existing?.reputation_score ?? null,
    bounce_rate: existing?.bounce_rate ?? null,
    reply_rate: existing?.reply_rate ?? null,
    health_score: healthScore,
    last_calculated_at: new Date().toISOString(),
  });

  revalidatePath("/settings/deliverability");
}
