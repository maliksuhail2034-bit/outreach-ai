import { BadgeCheckIcon, ShieldIcon } from "lucide-react";

import type { Tables } from "@/types/database.types";
import { FadeIn } from "@/components/motion/fade-in";
import { StatusCard, type StatusTone } from "@/components/dashboard/status-card";

const DOMAIN_STATUS_TONE: Record<string, StatusTone> = {
  verified: "default",
  pending: "secondary",
  failed: "destructive",
};

function dnsTone(verified: boolean): StatusTone {
  return verified ? "default" : "secondary";
}

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// SPF/DKIM/DMARC/MX + overall verification status for one domain —
// extracted from the Mailbox Analytics page's Deliverability section so
// Domain Analytics renders the identical facts instead of hand-copying the
// same five cards. Every value comes straight from the domains row; no new
// calculation here.
export function DomainDnsStatus({
  domain,
  delayStart = 0,
}: {
  domain: Pick<Tables<"domains">, "spf_verified" | "dkim_verified" | "dmarc_verified" | "mx_verified" | "status">;
  delayStart?: number;
}) {
  return (
    <div className="@container">
      <div className="grid gap-4 @sm:grid-cols-2 @lg:grid-cols-5">
        <FadeIn delay={delayStart}>
          <StatusCard title="SPF" status={domain.spf_verified ? "Verified" : "Not verified"} tone={dnsTone(domain.spf_verified)} icon={<ShieldIcon className="size-4" />} />
        </FadeIn>
        <FadeIn delay={delayStart + 0.02}>
          <StatusCard title="DKIM" status={domain.dkim_verified ? "Verified" : "Not verified"} tone={dnsTone(domain.dkim_verified)} icon={<ShieldIcon className="size-4" />} />
        </FadeIn>
        <FadeIn delay={delayStart + 0.04}>
          <StatusCard title="DMARC" status={domain.dmarc_verified ? "Verified" : "Not verified"} tone={dnsTone(domain.dmarc_verified)} icon={<ShieldIcon className="size-4" />} />
        </FadeIn>
        <FadeIn delay={delayStart + 0.06}>
          <StatusCard title="MX" status={domain.mx_verified ? "Verified" : "Not verified"} tone={dnsTone(domain.mx_verified)} icon={<ShieldIcon className="size-4" />} />
        </FadeIn>
        <FadeIn delay={delayStart + 0.08}>
          <StatusCard title="Domain verification" status={statusLabel(domain.status)} tone={DOMAIN_STATUS_TONE[domain.status] ?? "outline"} icon={<BadgeCheckIcon className="size-4" />} />
        </FadeIn>
      </div>
    </div>
  );
}
