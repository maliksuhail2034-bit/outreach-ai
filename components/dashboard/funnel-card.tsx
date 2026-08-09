import { cn } from "@/lib/utils";

const FILL_CLASS: Record<"brand" | "success" | "warning" | "danger", string> = {
  brand: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
};

export interface FunnelStage {
  key: string;
  label: string;
  value: number;
  // True for a stage with no real data source yet (e.g. a future
  // Revenue Analytics "Won" stage) — rendered distinctly so a 0 for "no
  // pipeline exists" never looks the same as a 0 for "nothing converted."
  placeholder?: boolean;
}

// Reusable step-down funnel — each stage shows its count and what
// percentage of the funnel's first stage it represents. Generic over any
// ordered list of stages (not campaign-specific), so a future funnel
// elsewhere in the app reuses this instead of a new component. Self-
// handles the empty case the same way DailyBarChart/FailureAnalysis
// already do, rather than pushing that decision up to every caller.
export function FunnelCard({
  title,
  description,
  stages,
  tone = "brand",
}: {
  title: string;
  description?: string;
  stages: FunnelStage[];
  tone?: "brand" | "success" | "warning" | "danger";
}) {
  const base = stages[0]?.value ?? 0;

  return (
    <div className="rounded-xl border border-border bg-card/60 p-5 shadow-sm backdrop-blur-sm">
      <div>
        <h3 className="font-semibold tracking-tight">{title}</h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>

      {base === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No activity in this funnel yet.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {stages.map((stage) => {
            const percent = base > 0 ? Math.round((stage.value / base) * 100) : 0;
            return (
              <li key={stage.key}>
                <div className="flex items-center justify-between text-sm">
                  <span className={cn("font-medium", stage.placeholder && "text-muted-foreground")}>
                    {stage.label}
                    {stage.placeholder && (
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">(coming soon)</span>
                    )}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {stage.value.toLocaleString()}
                    {!stage.placeholder && ` (${percent}%)`}
                  </span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full", stage.placeholder ? "bg-muted-foreground/30" : FILL_CLASS[tone])}
                    style={{ width: `${stage.placeholder ? 0 : percent}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
