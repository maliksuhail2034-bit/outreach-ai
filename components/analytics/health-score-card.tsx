import { AlertTriangleIcon, CheckCircle2Icon, HeartPulseIcon } from "lucide-react";

import type { HealthScoreFactor } from "@/lib/analytics/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ScoreBadge } from "@/components/deliverability/score-badge";

// Presentational only — the score/factors are entirely computed by an
// entity-specific engine (lib/campaigns/health-score.ts's
// calculateCampaignHealthScore, lib/deliverability/scoring.ts's
// calculateDomainHealthScore); this component just renders whichever
// result it's given, so Campaign and Domain health share one card instead
// of each having its own near-identical copy.
export function HealthScoreCard({
  title,
  description,
  emptyTitle,
  emptyDescription,
  score,
  factors,
}: {
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
  score: number | null;
  factors: HealthScoreFactor[];
}) {
  if (score === null) {
    return <EmptyState icon={<HeartPulseIcon className="size-5" />} title={emptyTitle} description={emptyDescription} />;
  }

  const goodFactors = factors.filter((factor) => factor.tone === "good");
  const warningFactors = factors.filter((factor) => factor.tone === "warning");

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <ScoreBadge score={score} />
      </CardHeader>
      <CardContent className="space-y-4">
        {goodFactors.length === 0 && warningFactors.length === 0 ? (
          <p className="text-sm text-muted-foreground">No standout signals yet — everything&apos;s in a normal range.</p>
        ) : (
          <>
            {goodFactors.length > 0 && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">Good</p>
                <ul className="mt-1 space-y-1.5">
                  {goodFactors.map((factor) => (
                    <li key={factor.key} className="flex items-start gap-2 text-sm">
                      <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" />
                      {factor.detail}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {warningFactors.length > 0 && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">Warnings</p>
                <ul className="mt-1 space-y-1.5">
                  {warningFactors.map((factor) => (
                    <li key={factor.key} className="flex items-start gap-2 text-sm text-destructive">
                      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
                      {factor.detail}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
