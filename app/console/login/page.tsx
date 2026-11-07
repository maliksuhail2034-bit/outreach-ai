import { redirect } from "next/navigation";
import { ShieldCheckIcon } from "lucide-react";

import { getUser } from "@/lib/supabase/auth";
import { PolimatiqLogo } from "@/components/shell/polimatiq-logo";
import { StaffSignInForm } from "@/components/console/staff-sign-in-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Staff sign-in by username. Signed-in staff go straight on; a signed-in
// customer is sent back to the customer app (the console isn't advertised).
export default async function StaffSignInPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  const user = await getUser();
  if (user) redirect(user.app_metadata?.polimatiq_staff === true ? "/console" : "/dashboard");

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-4">
      <PolimatiqLogo width={120} />
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheckIcon className="size-5" aria-hidden="true" />
          </div>
          <CardTitle className="text-xl">Staff sign-in</CardTitle>
          <CardDescription>Use your staff username. You&apos;ll confirm with your authenticator app next.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {reason === "idle" && (
            <p role="status" className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
              You were signed out after 30 minutes without activity.
            </p>
          )}
          <StaffSignInForm />
        </CardContent>
      </Card>
      <p className="max-w-sm text-center text-xs text-muted-foreground">
        For Polimatiq employees only. Every sign-in is recorded. Forgot your password? Ask an owner or the security team.
      </p>
    </div>
  );
}
