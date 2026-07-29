import { LightbulbIcon } from "lucide-react";

const TIPS = [
  "Most users launch their first campaign in under 10 minutes.",
  "Personalized subject lines can double your reply rate.",
  "Warm up a new mailbox for 1-2 weeks before sending at full volume.",
];

export function DashboardTips() {
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-5">
      <div className="flex items-center gap-2 text-sm font-medium">
        <LightbulbIcon className="size-4 text-primary" />
        Tips to get started
      </div>
      <ul className="mt-3 space-y-2">
        {TIPS.map((tip) => (
          <li key={tip} className="flex gap-2 text-sm text-muted-foreground">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary/60" aria-hidden />
            {tip}
          </li>
        ))}
      </ul>
    </div>
  );
}
