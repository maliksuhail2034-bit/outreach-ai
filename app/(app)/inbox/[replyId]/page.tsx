import Link from "next/link";
import { notFound } from "next/navigation";

import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getEmailReplyThread } from "@/lib/db";
import { withRetry } from "@/lib/db/resilient-read";
import { replyLeadName } from "@/lib/inbox/format";
import { FadeIn } from "@/components/motion/fade-in";
import { Button } from "@/components/ui/button";
import { ReplyMessage } from "@/components/inbox/reply-message";
import { MarkConversationRead } from "@/components/inbox/mark-conversation-read";

// One conversation: every reply from this lead in this campaign, oldest
// first. Only inbound replies are stored — the emails that were sent aren't,
// so they aren't shown.
export default async function InboxConversationPage({ params }: { params: Promise<{ replyId: string }> }) {
  const { replyId } = await params;
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const supabase = await createClient();
  // Null for a missing, malformed or other user's reply (RLS) — all not found.
  const thread = await withRetry(() => getEmailReplyThread(supabase, replyId));
  if (!thread || thread.replies.length === 0) notFound();

  const first = thread.replies[0];
  const mailboxes = [
    ...new Set(thread.replies.map((reply) => reply.mailbox?.display_name || reply.mailbox?.email).filter(Boolean)),
  ];

  return (
    <div className="space-y-6 sm:space-y-8">
      <MarkConversationRead replyId={replyId} hasUnread={thread.replies.some((reply) => reply.read_at === null)} />

      <FadeIn>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{replyLeadName(first)}</h1>
            <p className="mt-1 text-sm text-muted-foreground sm:text-base">
              {thread.replies.length} {thread.replies.length === 1 ? "reply" : "replies"}
              {first.campaign && (
                <>
                  {" in "}
                  <Link href={`/campaigns/${thread.campaignId}`} className="font-medium text-foreground underline underline-offset-2">
                    {first.campaign.name}
                  </Link>
                </>
              )}
              {mailboxes.length > 0 && <> · received in {mailboxes.join(", ")}</>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/leads/${thread.leadId}`}>View lead</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/inbox">Back to inbox</Link>
            </Button>
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={0.05} className="space-y-4">
        {thread.replies.map((reply) => (
          <ReplyMessage key={reply.id} reply={reply} isNew={reply.read_at === null} />
        ))}
      </FadeIn>
    </div>
  );
}
