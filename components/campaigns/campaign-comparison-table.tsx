import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";

import type { TrendResult } from "@/lib/analytics/trends";
import { Badge } from "@/components/ui/badge";

const DIRECTION_VARIANT: Record<TrendResult["direction"], "default" | "secondary" | "destructive"> = {
  up: "default",
  down: "destructive",
  stable: "secondary",
};

const DIRECTION_ICON: Record<TrendResult["direction"], typeof TrendingUpIcon> = {
  up: TrendingUpIcon,
  down: TrendingDownIcon,
  stable: MinusIcon,
};

function formatValue(value: number | null, format: "count" | "percent") {
  if (value === null) return "—";
  return format === "percent" ? `${value}%` : value.toLocaleString();
}

export interface ComparisonMetricRow {
  key: string;
  label: string;
  format: "count" | "percent";
  aValue: number | null;
  bValue: number | null;
  // Direction/magnitude of A relative to B — feed
  // lib/analytics/campaign-metrics.ts's compareCampaignMetrics() output
  // directly, keyed the same as this row.
  trend: TrendResult;
}

// Metric-by-metric matrix for two campaigns, built entirely on
// compareCampaignMetrics()'s existing TrendResult output — this component
// only lays it out, it doesn't compute anything.
export function CampaignComparisonTable({
  campaignAName,
  campaignBName,
  rows,
}: {
  campaignAName: string;
  campaignBName: string;
  rows: ComparisonMetricRow[];
}) {
  return (
    <div className="rounded-xl border border-border bg-card/60 shadow-sm backdrop-blur-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="py-3 pl-5 pr-4 font-medium">Metric</th>
              <th className="max-w-40 truncate py-3 pr-4 font-medium">{campaignAName}</th>
              <th className="max-w-40 truncate py-3 pr-4 font-medium">{campaignBName}</th>
              <th className="py-3 pr-5 font-medium">A vs. B</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => {
              const Icon = DIRECTION_ICON[row.trend.direction];
              return (
                <tr key={row.key}>
                  <td className="py-3 pl-5 pr-4 text-muted-foreground">{row.label}</td>
                  <td className="py-3 pr-4 font-medium tabular-nums">{formatValue(row.aValue, row.format)}</td>
                  <td className="py-3 pr-4 font-medium tabular-nums">{formatValue(row.bValue, row.format)}</td>
                  <td className="py-3 pr-5">
                    <Badge variant={DIRECTION_VARIANT[row.trend.direction]} className="gap-1">
                      <Icon className="size-3" />
                      {row.trend.percentageChange === null
                        ? row.trend.direction
                        : `${Math.abs(row.trend.percentageChange)}%`}
                    </Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
