import { InboxIcon } from "lucide-react";

import type { CampaignMailboxSummary, MailboxInsight } from "@/lib/campaigns/mailbox-insights";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { InsightList } from "@/components/analytics/insights-card";

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
        <InsightList insights={insights} />

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
