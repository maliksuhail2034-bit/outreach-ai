import { FileTextIcon, ImageIcon, PaperclipIcon } from "lucide-react";

import { renderEmailContent } from "@/lib/email/render-email";
import { SAMPLE_LEAD } from "@/lib/email/sample-lead";
import { formatBytes } from "@/lib/email/attachment-validation";
import { cn } from "@/lib/utils";
import type { AttachmentSummary } from "./attachment-manager";

// An email as the recipient sees it in their inbox: subject, sender and
// recipient line, the personalized body and attachments. Rendered through
// the exact path production sends use (lib/email/render-email.ts), with the
// sample lead filled in, so what's shown is what goes out.
export function EmailPreviewPane({
  subject,
  body,
  attachments = [],
  className,
}: {
  subject: string;
  body: string;
  attachments?: AttachmentSummary[];
  className?: string;
}) {
  const rendered = renderEmailContent(subject, body, SAMPLE_LEAD);
  const recipientName = [SAMPLE_LEAD.first_name, SAMPLE_LEAD.last_name].filter(Boolean).join(" ");
  const hasUnsubscribeLink = /\{\{\s*unsubscribe_link\s*\}\}/.test(body);

  return (
    <div className={cn("min-w-0 space-y-3", className)}>
      <article className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <header className="space-y-3 border-b border-border px-5 py-4">
          <h3 className="text-base font-semibold break-words text-foreground">
            {rendered.subject || <span className="text-muted-foreground">(No subject)</span>}
          </h3>
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
            >
              Y
            </span>
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-medium text-foreground">
                You <span className="font-normal text-muted-foreground">via your sending mailbox</span>
              </p>
              <p className="truncate text-xs text-muted-foreground">
                to {recipientName} &lt;{SAMPLE_LEAD.email}&gt;
              </p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">now</span>
          </div>
        </header>

        <div className="max-h-[28rem] overflow-y-auto px-5 py-4 text-sm leading-relaxed break-words text-foreground [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_p]:mb-3 [&_p:last-child]:mb-0">
          {rendered.html ? (
            // Safe: renderEmailContent HTML-escapes every piece of text and
            // only emits <p>, <br>, <strong>, <em> and <a href="http(s)://…">
            // itself (lib/email/render-email.ts), never raw template or lead input.
            <div dangerouslySetInnerHTML={{ __html: rendered.html }} />
          ) : (
            <p className="text-muted-foreground">Start writing and the email appears here.</p>
          )}
          {!hasUnsubscribeLink && rendered.html && (
            <p className="mt-6 border-t border-border pt-3 text-xs text-muted-foreground">
              An unsubscribe link is added here when the email is sent.
            </p>
          )}
        </div>

        {attachments.length > 0 && (
          <footer className="border-t border-border px-5 py-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <PaperclipIcon aria-hidden className="size-3.5" />
              {attachments.length} attachment{attachments.length === 1 ? "" : "s"}
            </p>
            <ul className="flex flex-wrap gap-2">
              {attachments.map((attachment) => (
                <li
                  key={attachment.id}
                  className="flex max-w-full items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs"
                >
                  {attachment.mimeType === "application/pdf" ? (
                    <FileTextIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ImageIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate font-medium text-foreground">{attachment.fileName}</span>
                  <span className="shrink-0 text-muted-foreground">{formatBytes(attachment.sizeBytes)}</span>
                </li>
              ))}
            </ul>
          </footer>
        )}
      </article>

      <p className="text-xs text-muted-foreground">
        Shown as {recipientName} at {SAMPLE_LEAD.company} would get it: variables are filled with this sample lead,
        and each real lead gets their own details.
      </p>
      {rendered.unsupportedTags.length > 0 && (
        <p className="text-xs text-destructive">
          Unsupported variable{rendered.unsupportedTags.length === 1 ? "" : "s"}:{" "}
          {rendered.unsupportedTags.map((tag) => `{{${tag}}}`).join(", ")}
        </p>
      )}
    </div>
  );
}
