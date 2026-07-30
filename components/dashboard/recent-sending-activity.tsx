import { SparklesIcon } from "lucide-react";

import type { Tables } from "@/types/database.types";
import { Badge } from "@/components/ui/badge";

type SendAttempt = Tables<"send_attempts">;

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "destructive" | "secondary" }> = {
  sent: { label: "Sent", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
  pending: { label: "Pending", variant: "secondary" },
};

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

export function RecentSendingActivity({ attempts }: { attempts: SendAttempt[] }) {
  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold tracking-tight">Recent sending activity</h2>
          <p className="text-sm text-muted-foreground">Latest send attempts across your campaigns.</p>
        </div>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <SparklesIcon className="size-4" />
        </span>
      </div>

      {attempts.length === 0 ? (
        <p className="mt-6 flex-1 text-sm text-muted-foreground">
          Nothing sent yet — activity will appear here once a campaign starts sending.
        </p>
      ) : (
        <ol className="mt-6 flex-1 space-y-4">
          {attempts.map((attempt) => {
            const badge = STATUS_BADGE[attempt.status] ?? { label: attempt.status, variant: "secondary" as const };
            const timestamp = attempt.resolved_at ?? attempt.claimed_at;

            return (
              <li key={attempt.id} className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  {attempt.status === "failed" && attempt.last_error && (
                    <p className="mt-1 max-w-52 truncate text-xs text-muted-foreground" title={attempt.last_error}>
                      {attempt.last_error}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDate(timestamp)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
