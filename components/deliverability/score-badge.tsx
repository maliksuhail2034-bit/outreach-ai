import { Badge } from "@/components/ui/badge";

function variantForScore(score: number): "default" | "secondary" | "destructive" {
  if (score >= 80) return "default";
  if (score >= 50) return "secondary";
  return "destructive";
}

// Shared by domain and mailbox health lists — see lib/deliverability/scoring.ts
// for how the 0-100 score itself is calculated.
export function ScoreBadge({ score }: { score: number }) {
  return <Badge variant={variantForScore(score)}>{score}/100</Badge>;
}
