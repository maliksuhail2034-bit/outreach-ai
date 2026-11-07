import type { SequenceStepSummary } from "@/lib/analytics/sequence-step-metrics";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// "12 (40%)": people, and their share of the people the step was sent to.
function formatCount(count: number, value: number | null) {
  return value === null ? "—" : `${count} (${value}%)`;
}

// Presentational only — receives already-computed SequenceStepSummary[]
// (see lib/analytics/sequence-step-metrics.ts) and renders it. Same table
// markup convention as CampaignQueueView/CampaignPerformanceTable, not a
// new pattern.
export function SequenceStepPerformanceTable({ steps }: { steps: SequenceStepSummary[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sequence step performance</CardTitle>
        <CardDescription>
          People each step was sent to, and how many of them opened, clicked and replied. Security scanners
          are left out, and a click counts as an open.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {steps.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm font-medium">No sequence steps yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add a step to this campaign&apos;s sequence to see performance here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Step</th>
                  <th className="py-2 pr-4 font-medium">Sent</th>
                  <th className="py-2 pr-4 font-medium">Opened</th>
                  <th className="py-2 pr-4 font-medium">Clicked</th>
                  <th className="py-2 pr-4 font-medium">Replied</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {steps.map((step) => (
                  <tr key={step.stepId}>
                    <td className="max-w-56 truncate py-3 pr-4 font-medium">
                      {step.order}. {step.label}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">{step.sentCount}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{formatCount(step.openedCount, step.openRate)}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{formatCount(step.clickedCount, step.clickRate)}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{formatCount(step.repliedCount, step.replyRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
