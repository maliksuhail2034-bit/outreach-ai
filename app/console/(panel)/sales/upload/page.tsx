import { createAdminClient } from "@/lib/supabase/admin";
import { listVerifiedLeadBatches } from "@/lib/db";
import { requireStaffPage } from "@/lib/staff/auth";
import { todayIsoDate } from "@/lib/verified-leads/period";
import { LeadUploadForm } from "@/components/console/lead-upload-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export default async function UploadLeadsPage() {
  await requireStaffPage("leads:manage");
  const batches = await listVerifiedLeadBatches(createAdminClient(), 25);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Upload verified leads</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Added leads join the pool that paying customers receive each month. Customers never see full addresses or
          download them — they can only email them from inside Polimatiq.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <LeadUploadForm today={todayIsoDate()} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent uploads</CardTitle>
          <CardDescription>The last 25 batches.</CardDescription>
        </CardHeader>
        <CardContent className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">No uploads yet.</p>
          ) : (
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">When</th>
                  <th scope="col" className="py-2 pr-4 font-medium">File</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Source</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Rows</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Added</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Duplicates</th>
                  <th scope="col" className="py-2 text-right font-medium">Rejected</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {batches.map((batch) => (
                  <tr key={batch.id}>
                    <td className="py-2 pr-4 text-muted-foreground">{dateFormatter.format(new Date(batch.created_at))}</td>
                    <td className="max-w-48 truncate py-2 pr-4">{batch.file_name}</td>
                    <td className="max-w-48 truncate py-2 pr-4 text-muted-foreground">{batch.source}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{batch.row_count}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{batch.inserted_count}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">{batch.duplicate_count}</td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">{batch.rejected_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
