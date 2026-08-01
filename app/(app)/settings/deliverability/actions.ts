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
  insertDomainDnsCheck,
  updateDomain,
  upsertMailboxHealth,
} from "@/lib/db";
import { domainSchema, type DomainInput } from "@/lib/validations/deliverability";
import { getDnsProvider } from "@/lib/deliverability/get-dns-provider";
import { calculateDomainHealthScore, calculateMailboxHealthScore } from "@/lib/deliverability/scoring";
import type { DnsRecordType, WarmupStatus } from "@/lib/deliverability/types";

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
// Nothing populates real reputation/bounce/reply data yet (that's a future
// warmup/reputation integration), but this exercises the same pipeline
// those features will drive: they upsert mailbox_health, then this same
// scorer runs — nothing here needs to change when they land.
export async function recalculateMailboxHealthAction(mailboxId: string) {
  const user = await requireUser();
  const supabase = await createClient();

  await getMailbox(supabase, user.id, mailboxId); // throws if not owned
  const existing = await getMailboxHealth(supabase, user.id, mailboxId);
  const warmupStatus = (existing?.warmup_status ?? "not_started") as WarmupStatus;

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
