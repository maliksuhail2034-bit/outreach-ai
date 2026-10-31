import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listMySessions } from "@/lib/db";
import { formatRelativeTime } from "@/lib/inbox/format";
import { describeUserAgent } from "@/lib/user-agent";
import { FadeIn } from "@/components/motion/fade-in";
import { SessionsPanel, type SessionRow } from "@/components/settings/sessions-panel";

export default async function SessionsSettingsPage() {
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const supabase = await createClient();
  const sessions = await listMySessions(supabase);
  const now = new Date();

  // Times are formatted here, on the server, so the client renders exactly
  // the same text it was sent (no hydration mismatch from a different clock).
  const rows: SessionRow[] = sessions.map((session) => ({
    id: session.id,
    ...describeUserAgent(session.userAgent),
    isCurrent: session.isCurrent,
    lastActive: formatRelativeTime(session.lastActiveAt, now),
    signedIn: formatRelativeTime(session.createdAt, now),
  }));

  return (
    <div className="max-w-2xl space-y-6 sm:space-y-8">
      <FadeIn>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Sessions</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Devices where your account is signed in. Log out any you don&apos;t recognise.
          </p>
        </div>
      </FadeIn>

      <FadeIn delay={0.05}>
        <SessionsPanel sessions={rows} />
      </FadeIn>
    </div>
  );
}
