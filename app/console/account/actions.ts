"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireStaffAccountAction, requireStaffAction, StaffAccessError } from "@/lib/staff/auth";
import { recordStaffAction } from "@/lib/staff/audit";
import { changeOwnUsername, setOwnPassword, StaffAccountError } from "@/lib/staff/accounts";
import { runStaffAction } from "@/lib/staff/run-action";
import { checkRateLimit, RateLimitError } from "@/lib/rate-limit/check-rate-limit";
import { ownPasswordSchema, usernameSchema } from "@/lib/validations/staff";

export type OwnPasswordState = { error?: string } | undefined;

// The signed-in staff member's own password. Works during first-time setup
// (no authenticator yet) and after 2-step login; a person with an
// authenticator must verify it first (requireStaffAccountAction).
export async function setOwnPasswordAction(_previous: OwnPasswordState, formData: FormData): Promise<OwnPasswordState> {
  let nextPath = "/console";
  try {
    const session = await requireStaffAccountAction();
    const parsed = ownPasswordSchema.safeParse({ password: formData.get("password"), confirmPassword: formData.get("confirmPassword") });
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
    await checkRateLimit("auth:reset_password", session.user.id);
    const supabase = await createClient();
    await setOwnPassword(createAdminClient(), session.staff, session.user.email ?? null, parsed.data.password, async (password) => {
      const { error } = await supabase.auth.updateUser({ password });
      return { error };
    });
    await recordStaffAction(session, "staff.password_changed", { targetType: "staff_member", targetId: session.staff.id });
    nextPath = session.mfa === "needs_enrollment" ? "/console/2fa/setup" : "/console";
  } catch (error) {
    if (error instanceof StaffAccessError || error instanceof StaffAccountError || error instanceof RateLimitError) {
      return { error: error.message };
    }
    console.error("[staff-console] own password change failed", error);
    return { error: "Couldn't save your password. Try again." };
  }
  redirect(nextPath);
}

export async function changeOwnUsernameAction(username: string) {
  return runStaffAction(async () => {
    const session = await requireStaffAction("console:overview");
    const next = usernameSchema.parse(username);
    const { staff, previous } = await changeOwnUsername(createAdminClient(), session.staff, next);
    if (previous !== staff.username) {
      await recordStaffAction(session, "staff.own_username_changed", {
        targetType: "staff_member",
        targetId: staff.id,
        metadata: { from: previous, to: staff.username },
      });
    }
    revalidatePath("/console/account");
    return { username: staff.username };
  });
}
