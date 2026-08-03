import { AlertTriangleIcon, CheckCircle2Icon, InfoIcon } from "lucide-react";

import type { Insight } from "@/lib/analytics/insights";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const TONE_ICON: Record<Insight["tone"], typeof CheckCircle2Icon> = {
  good: CheckCircle2Icon,
  warning: AlertTriangleIcon,
  info: InfoIcon,
};

const TONE_CLASS: Record<Insight["tone"], string> = {
  good: "text-primary",
  warning: "text-destructive",
  info: "text-muted-foreground",
};

// Entity-agnostic rendering of lib/analytics/insights.ts's rule-based
// output — every insight is computed upstream (health-score factors,
// trend/forecast/benchmark call-outs); this only lays the list out, the
// same convention health-score-card.tsx and rollup-table.tsx already
// follow. Also used by components/campaigns/campaign-mailbox-insights.tsx
// so the two insight surfaces in the app render identically instead of two
// copies of the same list markup.
export function InsightList({ insights }: { insights: Insight[] }) {
  return (
    <ul className="space-y-1.5">
      {insights.map((insight) => {
        const Icon = TONE_ICON[insight.tone];
        return (
          <li key={insight.key} className="flex items-start gap-2 text-sm">
            <Icon className={cn("mt-0.5 size-4 shrink-0", TONE_CLASS[insight.tone])} />
            <span>{insight.message}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function InsightsCard({
  title,
  description,
  insights,
}: {
  title: string;
  description: string;
  insights: Insight[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <InsightList insights={insights} />
      </CardContent>
    </Card>
  );
}
