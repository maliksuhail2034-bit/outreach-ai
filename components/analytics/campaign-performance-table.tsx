import Link from "next/link";

import type { Tables } from "@/types/database.types";
import type { RangeRates, RangeTotals } from "@/lib/analytics/range-metrics";
import { Badge } from "@/components/ui/badge";

type Campaign = Tables<"campaigns">;

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  active: "default",
  paused: "secondary",
  completed: "secondary",
};

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function percent(value: number | null) {
  return value === null ? "—" : `${value}%`;
}

export interface CampaignPerformanceRow {
  campaign: Campaign;
  totals: RangeTotals;
  rates: RangeRates;
}

// Per-campaign results for the selected analytics range. Rows come
// pre-aggregated from analytics_campaign_event_counts() — one row per
// campaign regardless of how many leads it has.
export function CampaignPerformanceTable({ rows, rangeLabel }: { rows: CampaignPerformanceRow[]; rangeLabel: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
      <div>
        <h2 className="font-semibold tracking-tight">Campaign performance</h2>
        <p className="text-sm text-muted-foreground">
          Sends and engagement per campaign, {rangeLabel}. Rates are per contacted lead; bounce rate is per email sent.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium">No campaigns yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Performance data will appear once a campaign sends.</p>
        </div>
      ) : (
        <div className="mt-6 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-4 font-medium">Campaign</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">Sent</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">Contacted</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">Opened</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">Clicked</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">Replied</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">Bounced</th>
                <th scope="col" className="py-2 text-right font-medium">Failed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(({ campaign, totals, rates }) => (
                <tr key={campaign.id}>
                  <td className="max-w-56 py-3 pr-4">
                    <Link href={`/campaigns/${campaign.id}/analytics`} className="block truncate font-medium hover:underline">
                      {campaign.name}
                    </Link>
                    <div className="mt-1">
                      <Badge variant={STATUS_VARIANT[campaign.status] ?? "outline"}>{statusLabel(campaign.status)}</Badge>
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums">{totals.sent}</td>
                  <td className="py-3 pr-4 text-right tabular-nums text-muted-foreground">{totals.contacted}</td>
                  <td className="py-3 pr-4 text-right tabular-nums text-muted-foreground">
                    {totals.uniqueOpens} <span className="text-xs">({percent(rates.openRate)})</span>
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums text-muted-foreground">
                    {totals.uniqueClicks} <span className="text-xs">({percent(rates.clickRate)})</span>
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums text-muted-foreground">
                    {totals.uniqueReplies} <span className="text-xs">({percent(rates.replyRate)})</span>
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums text-muted-foreground">
                    {totals.bounced} <span className="text-xs">({percent(rates.bounceRate)})</span>
                  </td>
                  <td className="py-3 text-right tabular-nums text-muted-foreground">{totals.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
