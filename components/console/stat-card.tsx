import type { ReactNode } from "react";
import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// A KPI tile: label, one headline value, optional hint and change versus the
// previous period. Change is shown with an arrow and text, never colour alone.
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  change,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  change?: number | null;
  tone?: "default" | "warning";
}) {
  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-4 shadow-sm sm:p-5",
        tone === "warning" ? "border-warning/50" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-muted-foreground sm:text-sm">{label}</p>
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
      </div>
      <p className="truncate text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">{value}</p>
      {(change !== undefined || hint) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {change !== undefined && <ChangeBadge change={change} />}
          {hint && <span className="min-w-0">{hint}</span>}
        </div>
      )}
    </div>
  );
}

function ChangeBadge({ change }: { change: number | null }) {
  if (change === null) return <span>No earlier data</span>;
  const Icon = change > 0 ? ArrowUpRightIcon : change < 0 ? ArrowDownRightIcon : MinusIcon;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-medium", change > 0 && "text-success", change < 0 && "text-destructive")}>
      <Icon className="size-3.5" aria-hidden="true" />
      {change > 0 ? "+" : ""}
      {change}%<span className="font-normal text-muted-foreground"><span className="sr-only sm:not-sr-only"> vs previous period</span></span>
    </span>
  );
}

export function StatGrid({ children, columns = 4 }: { children: ReactNode; columns?: 3 | 4 }) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3 sm:gap-4 [&>*:last-child:nth-child(odd)]:col-span-2",
        columns === 4 ? "lg:grid-cols-4 lg:[&>*:last-child:nth-child(odd)]:col-span-1" : "lg:grid-cols-3 lg:[&>*:last-child:nth-child(odd)]:col-span-1",
      )}
    >
      {children}
    </div>
  );
}
