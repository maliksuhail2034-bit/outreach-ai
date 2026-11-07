"use server";

import { getStaffSession } from "@/lib/staff/auth";
import { recordStaffAction } from "@/lib/staff/audit";

// Called by the setup form right after a successful first verification.
// Only records the event; requires the session to already be aal2, so it
// can't be used to fake an enrollment.
export async function recordMfaEnrolledAction(): Promise<void> {
  const session = await getStaffSession();
  if (!session || session.mfa !== "verified") return;
  await recordStaffAction(session, "staff.mfa_enrolled", { targetType: "staff_member", targetId: session.staff.id });
}
