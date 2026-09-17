import { AlertTriangleIcon } from "lucide-react";

import type { TemplateValidationIssue } from "@/lib/email/validate-template";
import { cn } from "@/lib/utils";

// Shared rendering for lib/email/validate-template.ts's issues — used both
// live in the composer (per step, as the user types) and aggregated in the
// campaign review step (across every step). Renders nothing for an empty
// list, so a valid template stays clean with no empty warning box (see
// validate-template.ts's "avoid noisy warnings for valid templates" goal).
// Non-blocking by design: these are quality hints, not launch-blocking
// errors — lib/campaigns/readiness.ts's own errors/warnings are unaffected
// and unrelated to this list.
export function TemplateValidationList({ issues, className }: { issues: TemplateValidationIssue[]; className?: string }) {
  if (issues.length === 0) return null;

  return (
    <div className={cn("space-y-1 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning", className)}>
      {issues.map((issue) => (
        <p key={`${issue.type}:${issue.tag ?? issue.message}`} className="flex items-start gap-2">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <span>{issue.message}</span>
        </p>
      ))}
    </div>
  );
}
