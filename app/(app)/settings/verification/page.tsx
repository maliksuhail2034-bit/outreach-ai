import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getUserOrganization, listVerificationProviderKeys } from "@/lib/db";
import { FadeIn } from "@/components/motion/fade-in";
import { VerificationProvidersPanel } from "@/components/settings/verification-providers-panel";

export default async function VerificationSettingsPage() {
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const supabase = await createClient();
  const organization = await getUserOrganization(supabase, user);

  const providerKeys = await listVerificationProviderKeys(supabase, organization.id);

  return (
    <div className="max-w-2xl space-y-6 sm:space-y-8">
      <FadeIn>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Verification</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Connect your own MillionVerifier API key to verify lead email addresses before you send. Outreach-ai
            never sees your key in plain text, stores no managed key of its own, and never purchases verification
            credit on your behalf.
          </p>
        </div>
      </FadeIn>

      <FadeIn delay={0.05}>
        <VerificationProvidersPanel providerKeys={providerKeys} />
      </FadeIn>
    </div>
  );
}
