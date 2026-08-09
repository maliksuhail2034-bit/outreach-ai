"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

// Icon-chip color per tone — "brand" (the default) is the original
// bg-primary/10 text-primary treatment every existing caller already
// renders with, so omitting `tone` is byte-identical to before this prop
// existed. The other tones exist for metrics that aren't a brand-neutral
// count (e.g. a failure count shouldn't look the same as "total campaigns").
const TONE_CLASS: Record<"brand" | "success" | "warning" | "danger", string> = {
  brand: "bg-primary/10 text-primary group-hover:bg-primary/15",
  success: "bg-success/10 text-success group-hover:bg-success/15",
  warning: "bg-warning/10 text-warning group-hover:bg-warning/15",
  danger: "bg-destructive/10 text-destructive group-hover:bg-destructive/15",
};

export function StatCard({
  title,
  value,
  description,
  emptyHint,
  isEmpty = false,
  icon,
  tone = "brand",
  className,
}: {
  title: string;
  value: ReactNode;
  description?: string;
  /** Shown instead of `description` when `isEmpty` is true — a concise, specific next action. */
  emptyHint?: string;
  isEmpty?: boolean;
  icon: ReactNode;
  /** Icon-chip color. Defaults to the brand treatment every caller used before this prop existed. */
  tone?: "brand" | "success" | "warning" | "danger";
  className?: string;
}) {
  const caption = isEmpty ? emptyHint : description;

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
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
            TONE_CLASS[tone],
          )}
        >
          {icon}
        </span>
      </div>
      <div
        className={cn("mt-3 text-2xl font-semibold tracking-tight", isEmpty && "text-muted-foreground/70")}
      >
        {value}
      </div>
      {caption && <p className="mt-1 text-xs text-muted-foreground">{caption}</p>}
    </motion.div>
  );
}
