import Link from "next/link";

import type { Tables } from "@/types/database.types";
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

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatDate(value: string | null) {
  if (!value) return "—";
  return dateFormatter.format(new Date(value));
}

export interface RecentCampaignRow {
  campaign: Campaign;
  leadsCount: number;
  nextSendAt: string | null;
  lastActivity: string;
}

export function RecentCampaignsTable({ rows }: { rows: RecentCampaignRow[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold tracking-tight">Recent campaigns</h2>
          <p className="text-sm text-muted-foreground">Your most recently created campaigns.</p>
        </div>
        <Link href="/campaigns" className="shrink-0 text-sm font-medium text-primary hover:underline">
          View all
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium">No campaigns yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            <Link href="/campaigns" className="text-primary hover:underline">
              Create your first campaign
            </Link>{" "}
            to start reaching leads.
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Leads</th>
                <th className="py-2 pr-4 font-medium">Next send</th>
                <th className="py-2 pl-4 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(({ campaign, leadsCount, nextSendAt, lastActivity }) => (
                <tr key={campaign.id}>
                  <td className="max-w-48 truncate py-3 pr-4">
                    <Link href={`/campaigns/${campaign.id}`} className="font-medium hover:underline">
                      {campaign.name}
                    </Link>
                  </td>
                  <td className="py-3 pr-4">
                    <Badge variant={STATUS_VARIANT[campaign.status] ?? "outline"}>
                      {statusLabel(campaign.status)}
                    </Badge>
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">{leadsCount}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{formatDate(nextSendAt)}</td>
                  <td className="py-3 pl-4 text-muted-foreground">{formatDate(lastActivity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
