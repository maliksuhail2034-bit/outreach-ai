import { redirect } from "next/navigation";
import { BadgeCheckIcon } from "lucide-react";
import { getUser } from "@/lib/supabase/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { CloseTab } from "@/components/auth/close-tab";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

// Landing page for the signup confirmation link, which opens in a new tab.
// The signup tab picks up the new session by itself (see
// components/auth/await-email-confirmation.tsx), so this tab only tries to
// close itself. Outside app/(auth)/ because that group redirects signed-in
// users.
export default async function EmailVerifiedPage() {
  const user = await getUser();
  if (!user) {
    redirect("/login");
  }

  return (
    <AuthShell>
      <CloseTab />
      <Card className="border-none shadow-none sm:border sm:shadow-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
            <BadgeCheckIcon className="size-6" />
          </div>
          <CardTitle className="text-2xl">Email verified</CardTitle>
          <CardDescription>
            You&apos;re signed in on the tab where you created your account. Please close this tab if it
            doesn&apos;t close automatically.
          </CardDescription>
        </CardHeader>
      </Card>
    </AuthShell>
  );
}
