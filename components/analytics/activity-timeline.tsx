import { Badge } from "@/components/ui/badge";

export interface TimelineEntry {
  id: string;
  source: "email_event" | "send_attempt";
  label: string;
  variant: "default" | "destructive" | "secondary" | "outline";
  detail?: string | null;
  timestamp: string;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatDate(value: string) {
  return dateFormatter.format(new Date(value));
}

export function ActivityTimeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <div>
        <h2 className="font-semibold tracking-tight">Activity timeline</h2>
        <p className="text-sm text-muted-foreground">Latest email events and send attempts, merged.</p>
      </div>

      {entries.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ol className="relative mt-6 space-y-5">
          <span aria-hidden className="absolute inset-y-2 left-[3px] w-px bg-border" />
          {entries.map((entry) => (
            <li key={`${entry.source}-${entry.id}`} className="relative flex items-start justify-between gap-3 pl-5">
              <span
                aria-hidden
                className="absolute left-0 top-1.5 size-1.5 rounded-full bg-muted-foreground/50"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant={entry.variant}>{entry.label}</Badge>
                  <span className="text-xs uppercase tracking-wide text-muted-foreground/60">
                    {entry.source === "email_event" ? "Event" : "Attempt"}
                  </span>
                </div>
                {entry.detail && (
                  <p className="mt-1 max-w-64 truncate text-xs text-muted-foreground" title={entry.detail}>
                    {entry.detail}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{formatDate(entry.timestamp)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
