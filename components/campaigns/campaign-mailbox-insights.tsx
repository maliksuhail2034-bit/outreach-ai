import { AlertTriangleIcon, CheckCircle2Icon, InboxIcon, InfoIcon } from "lucide-react";

import type { CampaignMailboxSummary, MailboxInsight } from "@/lib/campaigns/mailbox-insights";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";

const TONE_ICON: Record<MailboxInsight["tone"], typeof CheckCircle2Icon> = {
  good: CheckCircle2Icon,
  warning: AlertTriangleIcon,
  info: InfoIcon,
};

const TONE_CLASS: Record<MailboxInsight["tone"], string> = {
  good: "text-primary",
  warning: "text-destructive",
  info: "text-muted-foreground",
};

// Presentational only — every insight/summary is computed entirely by
// lib/campaigns/mailbox-insights.ts's buildCampaignMailboxInsights(); this
// component just renders that result (same convention as CampaignHealthCard
// for calculateCampaignHealthScore).
export function CampaignMailboxInsightsCard({
  mailboxes,
  insights,
}: {
  mailboxes: CampaignMailboxSummary[];
  insights: MailboxInsight[];
}) {
  if (mailboxes.length === 0) {
    return (
      <EmptyState
        icon={<InboxIcon className="size-5" />}
        title="Not enough data yet"
        description="Mailbox intelligence appears once this campaign has sent from at least one mailbox."
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mailbox intelligence</CardTitle>
        <CardDescription>Plain-language insights across this campaign&apos;s sending mailboxes.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-1.5">
          {insights.map((insight) => {
            const Icon = TONE_ICON[insight.tone];
            return (
              <li key={insight.key} className="flex items-start gap-2 text-sm">
                <Icon className={cn("mt-0.5 size-4 shrink-0", TONE_CLASS[insight.tone])} />
                <span>{insight.message}</span>
              </li>
            );
          })}
        </ul>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="py-2 pl-3 pr-4 font-medium">Mailbox</th>
                <th className="py-2 pr-4 font-medium">Sent</th>
                <th className="py-2 pr-4 font-medium">Reply rate</th>
                <th className="py-2 pr-3 font-medium">Bounce rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {mailboxes.map((mailbox) => (
                <tr key={mailbox.mailboxId}>
                  <td className="max-w-40 truncate py-2 pl-3 pr-4 font-medium">{mailbox.label}</td>
                  <td className="py-2 pr-4 tabular-nums text-muted-foreground">{mailbox.sentCount}</td>
                  <td className="py-2 pr-4 tabular-nums text-muted-foreground">
                    {mailbox.replyRate === null ? "—" : `${mailbox.replyRate}%`}
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                    {mailbox.bounceRate === null ? "—" : `${mailbox.bounceRate}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
