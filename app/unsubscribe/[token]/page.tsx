import { createAdminClient } from "@/lib/supabase/admin";
import { getCampaignLead, getLeadById } from "@/lib/db";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe-token";
import { UnsubscribeConfirm } from "@/components/unsubscribe/unsubscribe-confirm";

// Public, unauthenticated route (outside app/(app)/, so app/(app)/layout.tsx's
// auth redirect never applies here — this page is reached by a recipient
// clicking a link in an email, not a logged-in user). Verifies the token
// and finds who it belongs to for display only — from the token itself, or
// for a legacy token from its enrollment; the actual unsubscribe happens on
// button click (see UnsubscribeConfirm) via a POST, not on this GET render —
// see that component for why.
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const verified = verifyUnsubscribeToken(token);

  let email: string | null = null;
  if (verified?.kind === "recipient") {
    email = verified.recipient.email;
  } else if (verified?.kind === "legacy") {
    try {
      const supabase = createAdminClient();
      const campaignLead = await getCampaignLead(supabase, verified.campaignLeadId);
      const lead = await getLeadById(supabase, campaignLead.lead_id);
      email = lead.email;
    } catch {
      email = null;
    }
  }

  if (!email) {
    return (
      <Centered>
        <h1 className="text-2xl font-semibold">Link no longer valid</h1>
        <p className="text-muted-foreground">This unsubscribe link is invalid or has already been used.</p>
      </Centered>
    );
  }

  return (
    <Centered>
      <h1 className="text-2xl font-semibold">Unsubscribe</h1>
      <p className="text-muted-foreground">
        Confirm you no longer want to receive emails at <strong>{email}</strong>.
      </p>
      <UnsubscribeConfirm token={token} />
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      {children}
    </div>
  );
}
