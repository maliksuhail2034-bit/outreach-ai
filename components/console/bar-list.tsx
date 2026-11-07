import type { ReactNode } from "react";

export interface BarListRow {
  key: string;
  label: ReactNode;
  value: number;
  secondary?: number;
}

// A ranked list with each row's magnitude drawn as a single-hue bar behind
// its label. It's a real table, so the numbers are always readable as text
// (screen readers, copy/paste) and the bar is only a visual aid.
export function BarList({
  rows,
  valueLabel,
  secondaryLabel,
  labelHeader,
  empty = "No data yet.",
}: {
  rows: BarListRow[];
  valueLabel: string;
  secondaryLabel?: string;
  labelHeader: string;
  empty?: string;
}) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;
  const max = Math.max(1, ...rows.map((row) => row.value));

  return (
    <table className="w-full table-fixed text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th scope="col" className="pb-2 font-medium">{labelHeader}</th>
          <th scope="col" className="w-20 pb-2 text-right font-medium">{valueLabel}</th>
          {secondaryLabel && <th scope="col" className="hidden w-20 pb-2 text-right font-medium sm:table-cell">{secondaryLabel}</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td className="py-1 pr-3">
              <div className="relative flex h-8 items-center overflow-hidden rounded-md">
                <div
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 rounded-md bg-primary/15 dark:bg-primary/25"
                  style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }}
                />
                <span className="relative truncate px-2.5">{row.label}</span>
              </div>
            </td>
            <td className="py-1 text-right font-medium tabular-nums">{row.value.toLocaleString()}</td>
            {secondaryLabel && (
              <td className="hidden py-1 text-right text-muted-foreground tabular-nums sm:table-cell">{(row.secondary ?? 0).toLocaleString()}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
