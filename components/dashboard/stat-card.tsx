"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils";

export function StatCard({
  title,
  value,
  description,
  emptyHint,
  isEmpty = false,
  icon,
  className,
}: {
  title: string;
  value: ReactNode;
  description?: string;
  /** Shown instead of `description` when `isEmpty` is true — a concise, specific next action. */
  emptyHint?: string;
  isEmpty?: boolean;
  icon: ReactNode;
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
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
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
