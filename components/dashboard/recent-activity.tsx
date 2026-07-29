import { ImportIcon, MegaphoneIcon, MessageSquareIcon, SparklesIcon } from "lucide-react";

const PLACEHOLDER_EVENTS = [
  { icon: ImportIcon, label: "Leads imported" },
  { icon: MegaphoneIcon, label: "Campaign launched" },
  { icon: MessageSquareIcon, label: "Reply received" },
];

export function RecentActivity() {
  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold tracking-tight">Recent activity</h2>
          <p className="text-sm text-muted-foreground">Imports, campaigns, and replies show up here.</p>
        </div>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <SparklesIcon className="size-4" />
        </span>
      </div>

      <ol className="relative mt-6 flex-1 space-y-6">
        <span aria-hidden className="absolute inset-y-4 left-4 w-px bg-border" />
        {PLACEHOLDER_EVENTS.map((event) => (
          <li key={event.label} className="relative flex items-center gap-3">
            <span className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-border bg-card text-muted-foreground/70">
              <event.icon className="size-3.5" />
            </span>
            <div className="flex flex-1 items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground/80">{event.label}</p>
              <span className="text-xs text-muted-foreground/50">—</span>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-6 border-t border-border pt-4 text-xs text-muted-foreground">
        Nothing&apos;s happened yet — this feed fills in automatically as you work.
      </p>
    </div>
  );
}
