"use client";

import { motion } from "framer-motion";

import type { DailyCount } from "@/lib/analytics/time-buckets";
import { cn } from "@/lib/utils";

const dayFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function formatDay(date: string) {
  return dayFormatter.format(new Date(`${date}T00:00:00Z`));
}

export function DailyBarChart({
  title,
  description,
  data,
  barClassName = "bg-primary",
}: {
  title: string;
  description: string;
  data: DailyCount[];
  barClassName?: string;
}) {
  const max = Math.max(1, ...data.map((point) => point.value));
  const total = data.reduce((sum, point) => sum + point.value, 0);

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold tracking-tight">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <span className="shrink-0 text-2xl font-semibold tabular-nums">{total}</span>
      </div>

      {total === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No activity in this window yet.</p>
      ) : (
        <div className="mt-6 flex h-32 items-end gap-1">
          {data.map((point) => (
            <div key={point.date} className="group relative flex flex-1 flex-col items-center justify-end">
              <span className="pointer-events-none absolute -top-6 hidden rounded bg-popover px-1.5 py-0.5 text-xs text-popover-foreground shadow-sm group-hover:block">
                {point.value}
              </span>
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: `${(point.value / max) * 100}%` }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className={cn("w-full min-h-[2px] rounded-t-sm", point.value > 0 ? barClassName : "bg-muted")}
              />
            </div>
          ))}
        </div>
      )}

      {total > 0 && (
        <div className="mt-2 flex justify-between text-xs text-muted-foreground">
          <span>{formatDay(data[0].date)}</span>
          <span>{formatDay(data[data.length - 1].date)}</span>
        </div>
      )}
    </div>
  );
}
