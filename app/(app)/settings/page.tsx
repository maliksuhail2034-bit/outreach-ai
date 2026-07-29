import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getProfile, getSettings } from "@/lib/db";
import { FadeIn } from "@/components/motion/fade-in";
import { ProfileForm } from "./profile-form";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage() {
  const user = await getUser();
  // app/(app)/layout.tsx already redirects unauthenticated requests before
  // this page renders; this narrows the type for what follows.
  if (!user) return null;

  const supabase = await createClient();
  const [profile, settings] = await Promise.all([getProfile(supabase, user.id), getSettings(supabase, user.id)]);

  return (
    <div className="max-w-2xl space-y-10">
      <FadeIn>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Manage your profile and sending preferences.
          </p>
        </div>
      </FadeIn>

      <FadeIn delay={0.05}>
        <ProfileForm
          email={user.email ?? ""}
          defaultValues={{
            fullName: profile?.full_name ?? "",
            avatarUrl: profile?.avatar_url ?? "",
            timezone: profile?.timezone ?? "UTC",
          }}
        />
      </FadeIn>

      <FadeIn delay={0.1}>
        <SettingsForm
          defaultValues={{
            signature: settings?.signature ?? "",
            unsubscribeText: settings?.unsubscribe_text ?? "",
            trackingEnabled: settings?.tracking_enabled ?? true,
            timezone: settings?.timezone ?? "UTC",
          }}
        />
      </FadeIn>
    </div>
  );
}
