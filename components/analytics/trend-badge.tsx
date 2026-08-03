import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";

import type { TrendResult } from "@/lib/analytics/trends";
import { Badge } from "@/components/ui/badge";

const DIRECTION_VARIANT: Record<TrendResult["direction"], "default" | "secondary" | "destructive"> = {
  up: "default",
  down: "destructive",
  stable: "secondary",
};

const DIRECTION_ICON: Record<TrendResult["direction"], typeof TrendingUpIcon> = {
  up: TrendingUpIcon,
  down: TrendingDownIcon,
  stable: MinusIcon,
};

// Renders any TrendResult as a direction-colored badge with its magnitude —
// extracted from components/analytics/comparison-table.tsx so an "A vs. B"
// comparison row and an "entity vs. peer average" benchmark row (see
// components/analytics/rollup-table.tsx) render the same trend the same
// way instead of two copies of this mapping.
export function TrendBadge({ trend }: { trend: TrendResult }) {
  const Icon = DIRECTION_ICON[trend.direction];
  return (
    <Badge variant={DIRECTION_VARIANT[trend.direction]} className="gap-1">
      <Icon className="size-3" />
      {trend.percentageChange === null ? trend.direction : `${Math.abs(trend.percentageChange)}%`}
    </Badge>
  );
}
