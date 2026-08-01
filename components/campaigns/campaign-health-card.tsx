import { AlertTriangleIcon, CheckCircle2Icon, HeartPulseIcon } from "lucide-react";

import type { CampaignHealthFactor } from "@/lib/campaigns/health-score";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ScoreBadge } from "@/components/deliverability/score-badge";

// Presentational only — score/factors are entirely computed by
// lib/campaigns/health-score.ts's calculateCampaignHealthScore(); this
// component just renders that result. Reuses ScoreBadge exactly as the
// Deliverability pages already do.
export function CampaignHealthCard({
  score,
  factors,
}: {
  score: number | null;
  factors: CampaignHealthFactor[];
}) {
  if (score === null) {
    return (
      <EmptyState
        icon={<HeartPulseIcon className="size-5" />}
        title="Not enough data yet"
        description="A health score appears once this campaign has real bounce/reply data, an engagement trend, or step performance to measure."
      />
    );
  }

  const goodFactors = factors.filter((factor) => factor.tone === "good");
  const warningFactors = factors.filter((factor) => factor.tone === "warning");

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>Campaign health</CardTitle>
          <CardDescription>Weighted from every signal with real data today.</CardDescription>
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
                      <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-primary" />
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
