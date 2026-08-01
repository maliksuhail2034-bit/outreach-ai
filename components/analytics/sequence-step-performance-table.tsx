import type { SequenceStepSummary } from "@/lib/analytics/sequence-step-metrics";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function formatRate(value: number | null) {
  return value === null ? "—" : `${value}%`;
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
          Sent and reply rate per step. Delivery, open, click, and positive-reply rate aren&apos;t tracked at the
          step level yet.
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
                  <th className="py-2 pr-4 font-medium">Delivery rate</th>
                  <th className="py-2 pr-4 font-medium">Open rate</th>
                  <th className="py-2 pr-4 font-medium">Click rate</th>
                  <th className="py-2 pr-4 font-medium">Reply rate</th>
                  <th className="py-2 pl-4 font-medium">Positive reply rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {steps.map((step) => (
                  <tr key={step.stepId}>
                    <td className="max-w-56 truncate py-3 pr-4 font-medium">{step.label}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{step.sentCount}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{formatRate(step.deliveryRate)}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{formatRate(step.openRate)}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{formatRate(step.clickRate)}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{formatRate(step.replyRate)}</td>
                    <td className="py-3 pl-4 text-muted-foreground">{formatRate(step.positiveReplyRate)}</td>
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
