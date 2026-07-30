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

export interface CampaignPerformanceRow {
  campaign: Campaign;
  leadsCount: number;
  attempts: number;
  failures: number;
  lastActivity: string | null;
}

export function CampaignPerformanceTable({ rows }: { rows: CampaignPerformanceRow[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <div>
        <h2 className="font-semibold tracking-tight">Campaign performance</h2>
        <p className="text-sm text-muted-foreground">Attempts, failures, and success rate per campaign.</p>
      </div>

      {rows.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium">No campaigns yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Performance data will appear once a campaign sends.</p>
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Campaign</th>
                <th className="py-2 pr-4 font-medium">Leads</th>
                <th className="py-2 pr-4 font-medium">Attempts</th>
                <th className="py-2 pr-4 font-medium">Failures</th>
                <th className="py-2 pr-4 font-medium">Success rate</th>
                <th className="py-2 pl-4 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(({ campaign, leadsCount, attempts, failures, lastActivity }) => {
                const successRate = attempts > 0 ? Math.round(((attempts - failures) / attempts) * 100) : null;

                return (
                  <tr key={campaign.id}>
                    <td className="max-w-48 truncate py-3 pr-4">
                      <Link href={`/campaigns/${campaign.id}`} className="font-medium hover:underline">
                        {campaign.name}
                      </Link>
                      <div className="mt-1">
                        <Badge variant={STATUS_VARIANT[campaign.status] ?? "outline"}>
                          {statusLabel(campaign.status)}
                        </Badge>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">{leadsCount}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{attempts}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{failures}</td>
                    <td className="py-3 pr-4 text-muted-foreground">
                      {successRate === null ? "—" : `${successRate}%`}
                    </td>
                    <td className="py-3 pl-4 text-muted-foreground">{formatDate(lastActivity)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
