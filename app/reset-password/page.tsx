import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetPasswordForm } from "./reset-password-form";

// Deliberately outside app/(auth)/ — that route group redirects
// authenticated users away, but this page requires the authenticated
// recovery session established by app/auth/confirm/route.ts.
export default async function ResetPasswordPage() {
  const user = await getUser();
  if (!user) {
    redirect("/forgot-password");
  }
  // Staff set their password in the console (stricter policy). Older staff
  // setup links pointed here.
  if (user.app_metadata?.polimatiq_staff === true) {
    redirect("/console/account?required=password");
  }

  return (
    <AuthShell>
      <ResetPasswordForm />
    </AuthShell>
  );
}
