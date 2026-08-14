import type { ReactNode } from "react";
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

export interface ComparisonRow {
  key: string;
  label: string;
  currentValue: ReactNode;
  trend: TrendResult;
}

// Reusable "several metrics, each compared to a prior period" card — what
// a period-over-period dashboard section (this week vs. last week, across
// every metric at once) composes with. Feed it
// lib/analytics/comparisons.ts's compareMetrics() output directly.
export function ComparisonCard({
  title,
  description,
  rows,
}: {
  title: string;
  description?: string;
  rows: ComparisonRow[];
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div>
        <h3 className="font-semibold tracking-tight">{title}</h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Nothing to compare yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {rows.map((row) => {
            const Icon = DIRECTION_ICON[row.trend.direction];
            return (
              <li key={row.key} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                <span className="text-sm text-muted-foreground">{row.label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium tabular-nums">{row.currentValue}</span>
                  <Badge variant={DIRECTION_VARIANT[row.trend.direction]} className="gap-1">
                    <Icon className="size-3" />
                    {row.trend.percentageChange === null
                      ? row.trend.direction
                      : `${Math.abs(row.trend.percentageChange)}%`}
                  </Badge>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
