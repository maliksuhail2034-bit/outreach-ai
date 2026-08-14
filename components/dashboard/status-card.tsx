import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusTone = "default" | "secondary" | "destructive" | "success" | "outline";

// Reusable status indicator — a label, a toned badge, and an optional
// description. Generic enough for any dashboard that needs to show a state
// (a job's status, a sync's health, a feature's enablement) without
// inventing a bespoke card each time.
export function StatusCard({
  title,
  status,
  tone = "outline",
  icon,
  description,
  className,
}: {
  title: string;
  status: string;
  tone?: StatusTone;
  icon: ReactNode;
  description?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{title}</span>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </span>
      </div>
      <div className="mt-3">
        <Badge variant={tone}>{status}</Badge>
      </div>
      {description && <p className="mt-2 text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}
