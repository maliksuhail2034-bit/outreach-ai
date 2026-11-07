import { redirect } from "next/navigation";

import { requireStaffPendingMfa } from "@/lib/staff/auth";
import { needsPasswordChange } from "@/lib/staff/password-policy";
import { MfaSetupForm } from "@/components/console/mfa-forms";
import { TwoStepShell } from "../two-step-shell";

export default async function TwoStepSetupPage() {
  const session = await requireStaffPendingMfa();
  if (session.mfa === "verified") redirect("/console");
  if (session.mfa === "needs_verification") redirect("/console/2fa/verify");
  // First-time setup: a compliant password comes before the authenticator.
  if (needsPasswordChange(session.staff)) redirect("/console/account?required=password");

  return (
    <TwoStepShell title="Set up 2-step login" description={`Welcome, ${session.staff.display_name}. One more step before the staff console.`}>
      <MfaSetupForm />
    </TwoStepShell>
  );
}
