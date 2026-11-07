import { redirect } from "next/navigation";

import { requireStaffPendingMfa } from "@/lib/staff/auth";
import { MfaSetupForm } from "@/components/console/mfa-forms";
import { TwoStepShell } from "../two-step-shell";

export default async function TwoStepSetupPage() {
  const session = await requireStaffPendingMfa();
  if (session.mfa === "verified") redirect("/console");
  if (session.mfa === "needs_verification") redirect("/console/2fa/verify");

  return (
    <TwoStepShell title="Set up 2-step login" description={`Welcome, ${session.staff.display_name}. One more step before the staff console.`}>
      <MfaSetupForm />
    </TwoStepShell>
  );
}
