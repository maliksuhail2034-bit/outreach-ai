import { redirect } from "next/navigation";

import { requireStaffPendingMfa } from "@/lib/staff/auth";
import { MfaVerifyForm } from "@/components/console/mfa-forms";
import { TwoStepShell } from "../two-step-shell";

export default async function TwoStepVerifyPage() {
  const session = await requireStaffPendingMfa();
  if (session.mfa === "verified") redirect("/console");
  if (session.mfa === "needs_enrollment") redirect("/console/2fa/setup");

  return (
    <TwoStepShell title="2-step login" description="Enter the code from your authenticator app to open the staff console.">
      <MfaVerifyForm />
    </TwoStepShell>
  );
}
