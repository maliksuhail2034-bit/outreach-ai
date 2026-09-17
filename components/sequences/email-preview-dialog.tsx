"use client";

import { useState, type ReactNode } from "react";
import { EyeIcon, FileTextIcon, ImageIcon, PaperclipIcon } from "lucide-react";

import { renderEmailContent } from "@/lib/email/render-email";
import { SAMPLE_LEAD, SAMPLE_LEAD_FIELDS } from "@/lib/email/sample-lead";
import { formatBytes } from "@/lib/email/attachment-validation";
import type { AttachmentSummary } from "./attachment-manager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// Renders through the exact same canonical path production sends use
// (lib/email/render-email.ts, Batch 1) — no second renderer, so what a user
// sees here is what actually goes out, right down to paragraph spacing,
// line breaks, and clickable links. `attachments` (Batch 3) is metadata
// only — filename/type/size — never rendered inline; this stays a fast,
// safe preview rather than a PDF/image viewer.
export function EmailPreviewDialog({
  subject,
  body,
  attachments = [],
  trigger,
}: {
  subject: string;
  body: string;
  attachments?: AttachmentSummary[];
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Only rendered while the dialog can be open — no cost paid on every
  // keystroke of the composer this is embedded in.
  const rendered = open ? renderEmailContent(subject, body, SAMPLE_LEAD) : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="outline" size="sm">
            <EyeIcon />
            Preview
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Email preview</DialogTitle>
          <DialogDescription>
            How this email looks once personalized. Uses sample data below, not a real lead.
          </DialogDescription>
        </DialogHeader>

        {rendered && (
          <div className="space-y-4">
            <Badge variant="info" className="w-fit">
              Preview · sample data, not a real send
            </Badge>

            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs font-medium text-muted-foreground">Sample lead used below</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3">
                {SAMPLE_LEAD_FIELDS.map((field) => (
                  <div key={field.label}>
                    <dt className="text-muted-foreground">{field.label}</dt>
                    <dd className="truncate font-medium text-foreground">{field.value}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="overflow-hidden rounded-lg border border-border">
              <div className="border-b border-border bg-muted/40 px-4 py-2">
                <p className="text-xs text-muted-foreground">Subject</p>
                <p className="truncate text-sm font-medium text-foreground">{rendered.subject || "(No subject)"}</p>
              </div>
              <div className="max-h-80 overflow-y-auto bg-background px-4 py-4 text-sm leading-relaxed text-foreground [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_p]:mb-3 [&_p:last-child]:mb-0">
                {rendered.html ? (
                  // Safe: rendered.html comes from renderEmailContent, which
                  // HTML-escapes the entire merged body and only ever emits
                  // <p>, <br>, and <a href="http(s)://…"> itself (see
                  // lib/email/render-email.ts) — never raw user/lead input.
                  <div dangerouslySetInnerHTML={{ __html: rendered.html }} />
                ) : (
                  <p className="text-muted-foreground">(No content yet)</p>
                )}
              </div>
            </div>

            {attachments.length > 0 && (
              <div className="rounded-lg border border-border p-3">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <PaperclipIcon className="size-3.5" />
                  {attachments.length} attachment{attachments.length === 1 ? "" : "s"}
                </p>
                <ul className="space-y-1">
                  {attachments.map((attachment) => (
                    <li key={attachment.id} className="flex items-center gap-2 text-xs">
                      {attachment.mimeType === "application/pdf" ? (
                        <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate font-medium text-foreground">{attachment.fileName}</span>
                      <span className="shrink-0 text-muted-foreground">{formatBytes(attachment.sizeBytes)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {rendered.unsupportedTags.length > 0 && (
              <p className="text-xs text-destructive">
                Unsupported tag{rendered.unsupportedTags.length === 1 ? "" : "s"}:{" "}
                {rendered.unsupportedTags.map((tag) => `{{${tag}}}`).join(", ")}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
