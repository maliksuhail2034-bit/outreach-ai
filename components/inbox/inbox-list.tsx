import Link from "next/link";

import type { InboxReply } from "@/lib/db/email-replies";
import { formatRelativeTime, replyLeadName, replySnippet, replySubject } from "@/lib/inbox/format";

// The inbox's reply rows, newest first. Unread rows are bold with a dot and
// a screen-reader "Unread" label, so unread is never signalled by color alone.
export function InboxList({ replies, now }: { replies: InboxReply[]; now: Date }) {
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {replies.map((reply) => {
        const unread = reply.read_at === null;
        const mailbox = reply.mailbox?.display_name || reply.mailbox?.email;
        return (
          <li key={reply.id}>
            <Link
              href={`/inbox/${reply.id}`}
              className="flex gap-3 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
            >
              <span className="mt-1.5 flex size-2 shrink-0 items-center" aria-hidden={!unread}>
                {unread && <span className="size-2 rounded-full bg-primary" />}
              </span>
              <span className="min-w-0 flex-1 space-y-0.5">
                <span className="flex items-baseline justify-between gap-3">
                  <span className={unread ? "truncate font-semibold" : "truncate"}>
                    {unread && <span className="sr-only">Unread: </span>}
                    {replyLeadName(reply)}
                  </span>
                  <time dateTime={reply.received_at} className="shrink-0 text-xs text-muted-foreground">
                    {formatRelativeTime(reply.received_at, now)}
                  </time>
                </span>
                <span className={unread ? "block truncate text-sm font-medium" : "block truncate text-sm"}>
                  {replySubject(reply)}
                </span>
                <span className="block truncate text-sm text-muted-foreground">{replySnippet(reply.body_text)}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {reply.campaign?.name ?? "Campaign"}
                  {mailbox ? ` · ${mailbox}` : ""}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
