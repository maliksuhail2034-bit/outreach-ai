"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaffAction } from "@/lib/staff/auth";
import { recordStaffAction } from "@/lib/staff/audit";
import { changeStaffRole, createStaffAccount, resetStaffAccess, setStaffDisabled } from "@/lib/staff/accounts";
import { runStaffAction } from "@/lib/staff/run-action";
import { changeStaffRoleSchema, createStaffSchema, staffIdSchema, type CreateStaffInput } from "@/lib/validations/staff";
import type { StaffRole } from "@/lib/db";

// Every action re-checks the caller (staff:manage + 2-step login) itself;
// lib/staff/accounts.ts then enforces who may manage which role. Setup links
// are returned once to the operator's screen and never logged or stored.

export async function createStaffAccountAction(input: CreateStaffInput) {
  return runStaffAction(async () => {
    const session = await requireStaffAction("staff:manage");
    const parsed = createStaffSchema.parse(input);
    const { staff, setupLink } = await createStaffAccount(
      createAdminClient(),
      { userId: session.user.id, role: session.role },
      { email: parsed.email, displayName: parsed.displayName, role: parsed.role as StaffRole },
    );
    await recordStaffAction(session, "staff.created", {
      targetType: "staff_member",
      targetId: staff.id,
      metadata: { role: staff.role },
    });
    revalidatePath("/console/staff");
    return { setupLink };
  });
}

export async function setStaffDisabledAction(staffId: string, disabled: boolean) {
  return runStaffAction(async () => {
    const session = await requireStaffAction("staff:manage");
    const updated = await setStaffDisabled(createAdminClient(), { userId: session.user.id, role: session.role }, staffIdSchema.parse(staffId), disabled === true);
    await recordStaffAction(session, disabled ? "staff.disabled" : "staff.enabled", { targetType: "staff_member", targetId: updated.id });
    revalidatePath("/console/staff");
    return null;
  });
}

export async function changeStaffRoleAction(staffId: string, role: StaffRole) {
  return runStaffAction(async () => {
    const session = await requireStaffAction("staff:manage");
    const parsed = changeStaffRoleSchema.parse({ staffId, role });
    const updated = await changeStaffRole(createAdminClient(), { userId: session.user.id, role: session.role }, parsed.staffId, parsed.role as StaffRole);
    await recordStaffAction(session, "staff.role_changed", { targetType: "staff_member", targetId: updated.id, metadata: { role: updated.role } });
    revalidatePath("/console/staff");
    return null;
  });
}

export async function resetStaffAccessAction(staffId: string) {
  return runStaffAction(async () => {
    const session = await requireStaffAction("staff:manage");
    const result = await resetStaffAccess(createAdminClient(), { userId: session.user.id, role: session.role }, staffIdSchema.parse(staffId));
    await recordStaffAction(session, "staff.access_reset", { targetType: "staff_member", targetId: staffId });
    revalidatePath("/console/staff");
    return result;
  });
}
