"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";

import type { TrendResult } from "@/lib/analytics/trends";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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

const TONE_CLASS: Record<"brand" | "success" | "warning" | "danger", string> = {
  brand: "bg-primary/10 text-primary group-hover:bg-primary/15",
  success: "bg-success/10 text-success group-hover:bg-success/15",
  warning: "bg-warning/10 text-warning group-hover:bg-warning/15",
  danger: "bg-destructive/10 text-destructive group-hover:bg-destructive/15",
};

// Reusable "value + trend vs. a prior period" card — the building block
// every future per-metric trend view (Campaign/Mailbox/Domain/Warmup/
// Revenue Analytics) composes with, instead of each hand-rolling its own
// trend display. Feed it lib/analytics/trends.ts's calculateTrend() output
// directly.
export function TrendCard({
  title,
  value,
  trend,
  icon,
  description,
  tone = "brand",
  className,
}: {
  title: string;
  value: ReactNode;
  trend: TrendResult;
  icon: ReactNode;
  description?: string;
  tone?: "brand" | "success" | "warning" | "danger";
  className?: string;
}) {
  const Icon = DIRECTION_ICON[trend.direction];

  return (
    <motion.div
      whileHover={{ y: -3 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-lg hover:shadow-primary/5",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{title}</span>
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors", TONE_CLASS[tone])}>
          {icon}
        </span>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight">{value}</span>
        <Badge variant={DIRECTION_VARIANT[trend.direction]} className="gap-1">
          <Icon className="size-3" />
          {trend.percentageChange === null ? trend.direction : `${Math.abs(trend.percentageChange)}%`}
        </Badge>
      </div>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
    </motion.div>
  );
}
