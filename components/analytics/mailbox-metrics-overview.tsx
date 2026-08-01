import { EyeIcon, MailCheckIcon, MailWarningIcon, MessageCircleReplyIcon, MousePointerClickIcon, SendIcon } from "lucide-react";

import type { MailboxMetricsSummary } from "@/lib/analytics/mailbox-metrics";
import { FadeIn } from "@/components/motion/fade-in";
import { StatCard } from "@/components/dashboard/stat-card";
import { PercentageCard } from "@/components/dashboard/percentage-card";

// The six email_events-derived overview cards for a MailboxMetricsSummary-
// shaped result (summarizeMailboxMetrics's/summarizeDomainMetrics's output)
// — extracted from the Mailbox Analytics page so Domain Analytics renders
// the identical shape instead of hand-copying the same six cards. Renders
// a Fragment (no wrapping grid) so callers place it inside their own grid
// alongside whatever entity-specific cards they add around it.
export function MailboxMetricsOverviewCards({
  summary,
  delayStart = 0,
}: {
  summary: Pick<MailboxMetricsSummary, "sentCount" | "deliveredCount" | "openRate" | "clickRate" | "replyRate" | "bounceRate">;
  delayStart?: number;
}) {
  return (
    <>
      <FadeIn delay={delayStart}>
        <StatCard
          title="Emails sent"
          value={summary.sentCount}
          icon={<SendIcon className="size-4" />}
          isEmpty={summary.sentCount === 0}
          emptyHint="Will appear once sending starts."
        />
      </FadeIn>
      <FadeIn delay={delayStart + 0.02}>
        <StatCard
          title="Delivered"
          value={summary.deliveredCount}
          icon={<MailCheckIcon className="size-4" />}
          isEmpty={summary.deliveredCount === 0}
          emptyHint="Delivery confirmations aren't tracked yet."
        />
      </FadeIn>
      <FadeIn delay={delayStart + 0.04}>
        <PercentageCard title="Open rate" value={summary.openRate} icon={<EyeIcon className="size-4" />} description="Opened ÷ delivered" />
      </FadeIn>
      <FadeIn delay={delayStart + 0.06}>
        <PercentageCard title="Click rate" value={summary.clickRate} icon={<MousePointerClickIcon className="size-4" />} description="Clicked ÷ delivered" />
      </FadeIn>
      <FadeIn delay={delayStart + 0.08}>
        <PercentageCard title="Reply rate" value={summary.replyRate} icon={<MessageCircleReplyIcon className="size-4" />} description="Replied ÷ sent" />
      </FadeIn>
      <FadeIn delay={delayStart + 0.1}>
        <PercentageCard title="Bounce rate" value={summary.bounceRate} icon={<MailWarningIcon className="size-4" />} description="Bounced ÷ sent" />
      </FadeIn>
    </>
  );
}
