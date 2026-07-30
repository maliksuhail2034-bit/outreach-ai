import { ERROR_CATEGORY_LABELS, type ErrorCategory } from "@/lib/analytics/error-category";

export function FailureAnalysis({ counts }: { counts: Record<ErrorCategory, number> }) {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const categories = Object.keys(ERROR_CATEGORY_LABELS) as ErrorCategory[];

  return (
    <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
      <div>
        <h2 className="font-semibold tracking-tight">Failure analysis</h2>
        <p className="text-sm text-muted-foreground">Failed sends grouped by error type.</p>
      </div>

      {total === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">No failures recorded yet.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {categories.map((category) => {
            const count = counts[category];
            const percent = total > 0 ? Math.round((count / total) * 100) : 0;

            return (
              <li key={category}>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{ERROR_CATEGORY_LABELS[category]}</span>
                  <span className="text-muted-foreground">
                    {count} ({percent}%)
                  </span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-destructive/70"
                    style={{ width: `${percent}%` }}
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
