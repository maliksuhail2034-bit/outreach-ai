"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

const TONE_CLASS: Record<"brand" | "success" | "warning" | "danger", string> = {
  brand: "bg-primary/10 text-primary group-hover:bg-primary/15",
  success: "bg-success/10 text-success group-hover:bg-success/15",
  warning: "bg-warning/10 text-warning group-hover:bg-warning/15",
  danger: "bg-destructive/10 text-destructive group-hover:bg-destructive/15",
};

const FILL_CLASS: Record<"brand" | "success" | "warning" | "danger", string> = {
  brand: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
};

// Reusable rate/percentage display (reply rate, bounce rate, open rate,
// etc.) — a 0-100 value (or null for "not enough data yet") plus a
// progress bar, the shape any future rate-based metric card needs
// regardless of which rate it is. Pairs with lib/analytics/metrics.ts's
// rate() helper, which already returns null instead of a fake 0% when
// there's no denominator to divide by.
export function PercentageCard({
  title,
  value,
  icon,
  description,
  tone = "brand",
  className,
}: {
  title: string;
  value: number | null;
  icon: ReactNode;
  description?: string;
  tone?: "brand" | "success" | "warning" | "danger";
  className?: string;
}) {
  const isEmpty = value === null;
  const clamped = value === null ? 0 : Math.min(100, Math.max(0, value));

  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card/60 p-5 shadow-sm backdrop-blur-sm transition-shadow hover:shadow-lg hover:shadow-primary/5",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{title}</span>
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors", TONE_CLASS[tone])}>
          {icon}
        </span>
      </div>
      <div className={cn("mt-3 text-2xl font-semibold tracking-tight", isEmpty && "text-muted-foreground/70")}>
        {isEmpty ? "—" : `${value}%`}
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-[width]", FILL_CLASS[tone])} style={{ width: `${clamped}%` }} />
      </div>
      {description && <p className="mt-2 text-xs text-muted-foreground">{description}</p>}
    </motion.div>
  );
}
