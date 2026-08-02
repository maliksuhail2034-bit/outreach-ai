import Link from "next/link";

import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listDomains, listMailboxes } from "@/lib/db";
import { FadeIn } from "@/components/motion/fade-in";
import { Button } from "@/components/ui/button";
import { MailboxList } from "@/components/mailboxes/mailbox-list";

export default async function MailboxesPage() {
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const supabase = await createClient();
  const [mailboxes, domains] = await Promise.all([
    listMailboxes(supabase, user.id),
    listDomains(supabase, user.id),
  ]);

  return (
    <div className="max-w-4xl space-y-8">
      <FadeIn>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Mailboxes</h1>
            <p className="mt-1 text-sm text-muted-foreground sm:text-base">
              Connect the sending accounts you&apos;ll launch campaigns from.
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/mailboxes/compare">Compare mailboxes</Link>
          </Button>
        </div>
      </FadeIn>

      <FadeIn delay={0.05}>
        <MailboxList mailboxes={mailboxes} domains={domains ?? []} />
      </FadeIn>
    </div>
  );
}
