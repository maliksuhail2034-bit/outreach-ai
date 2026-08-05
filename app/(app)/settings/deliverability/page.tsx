import Link from "next/link";

import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getUserOrganization,
  listDomainDnsChecks,
  listDomains,
  listMailboxHealth,
  listMailboxes,
  listWarmupProfiles,
} from "@/lib/db";
import { latestDnsChecksByType } from "@/lib/deliverability/latest-dns-checks";
import type { DnsRecordType } from "@/lib/deliverability/types";
import type { Tables } from "@/types/database.types";
import { FadeIn } from "@/components/motion/fade-in";
import { Button } from "@/components/ui/button";
import { DomainHealthList } from "@/components/deliverability/domain-health-list";
import { MailboxHealthList } from "@/components/deliverability/mailbox-health-list";

export default async function DeliverabilityPage() {
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const supabase = await createClient();
  const organization = await getUserOrganization(supabase, user);

  const [domains, dnsChecks, mailboxes, mailboxHealth, warmupProfiles] = await Promise.all([
    listDomains(supabase, user.id),
    listDomainDnsChecks(supabase, user.id),
    listMailboxes(supabase, user.id),
    listMailboxHealth(supabase, user.id),
    listWarmupProfiles(supabase, organization.id),
  ]);

  // Plain objects, not Maps — these cross the Server -> Client Component
  // boundary as props, which only supports serializable values. dnsChecks
  // is already ordered newest-first (see listDomainDnsChecks), so filtering
  // per domain and reducing preserves that order.
  const latestChecksByDomain: Record<string, Partial<Record<DnsRecordType, Tables<"domain_dns_checks">>>> = {};
  for (const domain of domains ?? []) {
    latestChecksByDomain[domain.id] = latestDnsChecksByType(dnsChecks.filter((check) => check.domain_id === domain.id));
  }

  const healthByMailbox: Record<string, Tables<"mailbox_health">> = {};
  for (const row of mailboxHealth) {
    healthByMailbox[row.mailbox_id] = row;
  }

  // Read-only: Mailbox Health displays warmup stage/score without this
  // page writing anything back into warmup_profiles — see Task 6's
  // integration requirement.
  const warmupProfileByMailbox: Record<string, Tables<"warmup_profiles">> = {};
  for (const profile of warmupProfiles) {
    warmupProfileByMailbox[profile.mailbox_id] = profile;
  }

  return (
    <div className="max-w-4xl space-y-8">
      <FadeIn>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Deliverability</h1>
            <p className="mt-1 text-sm text-muted-foreground sm:text-base">
              Monitor domain and mailbox health ahead of warmup and inbox placement.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/settings/deliverability/compare">Compare domains</Link>
          </Button>
        </div>
      </FadeIn>

      <FadeIn delay={0.05}>
        <DomainHealthList domains={domains ?? []} latestChecksByDomain={latestChecksByDomain} />
      </FadeIn>

      <FadeIn delay={0.1}>
        <MailboxHealthList
          mailboxes={mailboxes}
          healthByMailbox={healthByMailbox}
          warmupProfileByMailbox={warmupProfileByMailbox}
        />
      </FadeIn>
    </div>
  );
}
