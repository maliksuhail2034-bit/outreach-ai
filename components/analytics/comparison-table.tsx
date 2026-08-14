import type { TrendResult } from "@/lib/analytics/trends";
import { TrendBadge } from "./trend-badge";

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
  // Direction/magnitude of A relative to B — feed a compare*Metrics()
  // TrendResult directly (lib/analytics/campaign-metrics.ts's
  // compareCampaignMetrics, lib/analytics/mailbox-metrics.ts's
  // compareMailboxMetrics, or a future compareDomainMetrics), keyed the
  // same as this row.
  trend: TrendResult;
}

// Entity-agnostic metric-by-metric matrix for any "A vs. B" comparison view
// — Campaign Comparison, Mailbox Comparison, and (once built) Domain
// Comparison all render the same shape, so this only lays rows out; it
// never computes anything itself. aLabel/bLabel are just display names
// (a campaign name, a mailbox email, a domain) — nothing here assumes
// which entity type produced the rows.
export function ComparisonTable({
  aLabel,
  bLabel,
  rows,
}: {
  aLabel: string;
  bLabel: string;
  rows: ComparisonMetricRow[];
}) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="py-3 pl-5 pr-4 font-medium">Metric</th>
              <th className="max-w-40 truncate py-3 pr-4 font-medium">{aLabel}</th>
              <th className="max-w-40 truncate py-3 pr-4 font-medium">{bLabel}</th>
              <th className="py-3 pr-5 font-medium">A vs. B</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.key}>
                <td className="py-3 pl-5 pr-4 text-muted-foreground">{row.label}</td>
                <td className="py-3 pr-4 font-medium tabular-nums">{formatValue(row.aValue, row.format)}</td>
                <td className="py-3 pr-4 font-medium tabular-nums">{formatValue(row.bValue, row.format)}</td>
                <td className="py-3 pr-5">
                  <TrendBadge trend={row.trend} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
