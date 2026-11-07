"use client";

import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";
import { UploadIcon } from "lucide-react";

import { uploadVerifiedLeadsAction } from "@/app/console/(panel)/sales/actions";
import type { UploadSummary } from "@/lib/verified-leads/upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LeadUploadForm({ today }: { today: string }) {
  const [pending, startTransition] = useTransition();
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const [source, setSource] = useState("");
  const [verifiedAt, setVerifiedAt] = useState(today);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await uploadVerifiedLeadsAction(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSummary(result.data);
      toast.success(`${result.data.inserted} leads added to the pool.`);
    });
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="upload-source">Source (required)</Label>
            <Input
              id="upload-source"
              name="source"
              required
              maxLength={200}
              placeholder="e.g. Apollo export, Nov 2026"
              value={source}
              onChange={(event) => setSource(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Kept with every lead so we can always say where the data came from (GDPR Art. 14). A “source” column in the
              file overrides it per row.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="upload-verified">Verified on</Label>
            <Input id="upload-verified" name="verifiedAt" type="date" required max={today} value={verifiedAt} onChange={(event) => setVerifiedAt(event.target.value)} />
            <p className="text-xs text-muted-foreground">Leads older than 180 days aren&apos;t delivered to customers.</p>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="upload-file">File (.csv or .tsv, up to 10,000 rows / 5 MB)</Label>
          <Input id="upload-file" name="file" type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" required />
          <p className="text-xs text-muted-foreground">
            Needs an <code>email</code> column. Recognised extras: first name, last name, company, title, website, LinkedIn,
            phone, city, country, industry, source, verified at. Excel/Sheets: save or download as CSV.
          </p>
        </div>
        <Button type="submit" disabled={pending}>
          <UploadIcon aria-hidden="true" />
          {pending ? "Uploading…" : "Upload to the pool"}
        </Button>
      </form>

      {summary && (
        <div role="status" className="rounded-lg border border-border p-4 text-sm">
          <p className="font-medium">Upload finished — {summary.totalRows} rows read</p>
          <ul className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-2">
            <li>Added to the pool: <span className="font-medium text-foreground">{summary.inserted}</span></li>
            <li>Already in the pool: {summary.alreadyInPool}</li>
            <li>Duplicates within the file: {summary.duplicatesInFile}</li>
            <li>Skipped — opted out or bounced before: {summary.suppressed}</li>
            <li>Rejected: {summary.rejected.length}</li>
          </ul>
          {summary.rejected.length > 0 && (
            <ul className="mt-3 max-h-48 space-y-0.5 overflow-y-auto text-xs text-destructive">
              {summary.rejected.map((item) => (
                <li key={item.row}>
                  Row {item.row}: {item.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
