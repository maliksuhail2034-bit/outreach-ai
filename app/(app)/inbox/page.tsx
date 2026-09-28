import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { countUnreadEmailReplies, listEmailRepliesPage } from "@/lib/db";
import { withRetry } from "@/lib/db/resilient-read";
import { parseInboxPage } from "@/lib/inbox/format";
import { FadeIn } from "@/components/motion/fade-in";
import { Card, CardContent } from "@/components/ui/card";
import { InboxList } from "@/components/inbox/inbox-list";
import { InboxPagination } from "@/components/inbox/inbox-pagination";

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const { page: pageParam } = await searchParams;
  const supabase = await createClient();

  // The page's own content, not optional widget data — a real failure is
  // this route's error state (error.tsx), after bounded retries of a
  // transient one.
  const [{ replies, page, pageSize, totalCount }, unreadCount] = await Promise.all([
    withRetry(() => listEmailRepliesPage(supabase, { page: parseInboxPage(pageParam) })),
    withRetry(() => countUnreadEmailReplies(supabase)),
  ]);

  return (
    <div className="space-y-6 sm:space-y-8">
      <FadeIn>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Inbox</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Replies from your leads, across every campaign and mailbox.
            {totalCount > 0 && <span className="font-medium text-foreground"> {unreadCount} unread.</span>}
          </p>
        </div>
      </FadeIn>

      <FadeIn delay={0.05} className="space-y-4">
        {replies.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center">
              <p className="font-medium">No replies yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Replies to your campaigns appear here once they&apos;re synced from your mailboxes.
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <InboxList replies={replies} now={new Date()} />
            <InboxPagination page={page} pageSize={pageSize} totalCount={totalCount} />
          </>
        )}
      </FadeIn>
    </div>
  );
}
