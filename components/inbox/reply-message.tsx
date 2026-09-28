import type { InboxReply } from "@/lib/db/email-replies";
import { replySenderName, replySubject } from "@/lib/inbox/format";
import { Badge } from "@/components/ui/badge";

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

// One inbound reply. The body is body_text rendered as a plain text child
// (React escapes it) with whitespace and line breaks preserved — never
// body_html, which is attacker-controlled and isn't even selected.
export function ReplyMessage({ reply, isNew }: { reply: InboxReply; isNew: boolean }) {
  const sender = replySenderName(reply);

  return (
    <article className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="font-medium">
            {sender}
            {sender !== reply.from_email && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">&lt;{reply.from_email}&gt;</span>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            To: {reply.to_emails.length > 0 ? reply.to_emails.join(", ") : "(no recipients)"}
          </p>
          <p className="text-sm">{replySubject(reply)}</p>
        </div>
        <div className="flex items-center gap-2">
          {isNew && <Badge variant="secondary">New</Badge>}
          <time dateTime={reply.received_at} className="text-sm text-muted-foreground">
            {dateTimeFormatter.format(new Date(reply.received_at))}
          </time>
        </div>
      </header>
      <div className="mt-4 whitespace-pre-wrap break-words text-sm">
        {reply.body_text?.trim() ? reply.body_text : <span className="text-muted-foreground">(no text content)</span>}
      </div>
    </article>
  );
}
