import { Badge } from "@/components/ui/badge";

function variantForScore(score: number): "success" | "warning" | "destructive" {
  if (score >= 80) return "success";
  if (score >= 50) return "warning";
  return "destructive";
}

// Shared by domain and mailbox health lists — see lib/deliverability/scoring.ts
// for how the 0-100 score itself is calculated. `measured` distinguishes a
// real (even if low) computed score from "nothing has been checked yet" —
// showing a destructive red 0/100 for the latter would misrepresent an
// unchecked domain/mailbox as a failing one.
export function ScoreBadge({ score, measured = true }: { score: number; measured?: boolean }) {
  if (!measured) {
    return <Badge variant="outline">Not yet measured</Badge>;
  }
  return <Badge variant={variantForScore(score)}>{score}/100</Badge>;
}
