import Link from "next/link";

import type { TrendResult } from "@/lib/analytics/trends";
import { ScoreBadge } from "@/components/deliverability/score-badge";
import { TrendBadge } from "./trend-badge";

export interface RollupRow {
  key: string;
  label: string;
  href: string;
  sentCount: number;
  replyRate: number | null;
  bounceRate: number | null;
  healthScore: number | null;
  // This row's reply rate vs. the peer-group average (see
  // lib/analytics/benchmarks.ts's compareToBenchmark) — null when there's
  // no peer average to compare against yet (e.g. only one entity of this
  // type exists), not a fabricated "stable."
  replyRateBenchmark?: TrendResult | null;
}

// Entity-agnostic "every X in the organization, one row each" table — the
// /analytics organization rollup renders this once each for campaigns,
// mailboxes, and domains instead of three near-identical tables. Purely
// presentational: every value is computed upstream by that entity's own
// summarize*/health-score engine (see lib/analytics/organization-rollup.ts),
// this component only lays rows out.
export function RollupTable({
  title,
  description,
  emptyLabel,
  rows,
}: {
  title: string;
  description: string;
  emptyLabel: string;
  rows: RollupRow[];
}) {
  // Only shown when the caller actually passes benchmark data (rollup rows
  // that don't opt in leave replyRateBenchmark undefined) — existing
  // callers render exactly as before with no empty column.
  const showBenchmarkColumn = rows.some((row) => row.replyRateBenchmark !== undefined);

  return (
    <div className="rounded-xl border border-border bg-card/60 shadow-sm backdrop-blur-sm">
      <div className="border-b border-border p-5">
        <h3 className="font-semibold tracking-tight">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {rows.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th className="py-3 pl-5 pr-4 font-medium">Name</th>
                <th className="py-3 pr-4 font-medium">Sent</th>
                <th className="py-3 pr-4 font-medium">Reply rate</th>
                <th className="py-3 pr-4 font-medium">Bounce rate</th>
                <th className="py-3 pr-4 font-medium">Health</th>
                {showBenchmarkColumn && <th className="py-3 pr-5 font-medium">Reply rate vs. avg</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className="max-w-56 truncate py-3 pl-5 pr-4 font-medium">
                    <Link href={row.href} className="hover:underline">
                      {row.label}
                    </Link>
                  </td>
                  <td className="py-3 pr-4 tabular-nums">{row.sentCount.toLocaleString()}</td>
                  <td className="py-3 pr-4 tabular-nums">{row.replyRate === null ? "—" : `${row.replyRate}%`}</td>
                  <td className="py-3 pr-4 tabular-nums">{row.bounceRate === null ? "—" : `${row.bounceRate}%`}</td>
                  <td className="py-3 pr-4">{row.healthScore === null ? "—" : <ScoreBadge score={row.healthScore} />}</td>
                  {showBenchmarkColumn && (
                    <td className="py-3 pr-5">
                      {row.replyRateBenchmark ? <TrendBadge trend={row.replyRateBenchmark} /> : "—"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
