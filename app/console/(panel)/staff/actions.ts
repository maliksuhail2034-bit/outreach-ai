"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaffAction } from "@/lib/staff/auth";
import { recordStaffAction } from "@/lib/staff/audit";
import {
  changeStaffRole,
  changeStaffUsername,
  createStaffAccount,
  deleteStaffAccount,
  resetStaffAccess,
  setStaffDisabled,
  setStaffPassword,
  signOutStaffEverywhere,
} from "@/lib/staff/accounts";
import { runStaffAction } from "@/lib/staff/run-action";
import {
  changeStaffRoleSchema,
  changeUsernameSchema,
  createStaffSchema,
  setStaffPasswordSchema,
  staffIdSchema,
  type CreateStaffInput,
  type SetStaffPasswordInput,
} from "@/lib/validations/staff";
import type { StaffRole } from "@/lib/db";

// Every action re-checks the caller (staff:manage + 2-step login) itself;
// lib/staff/accounts.ts then enforces who may manage which role (security
// never touches owners, nobody manages their own account here, the last
// owner can't be removed). Setup links and passwords are never logged.

function actor(session: Awaited<ReturnType<typeof requireStaffAction>>) {
  return { userId: session.user.id, role: session.role };
}

function revalidateEmployee(staffId?: string) {
  revalidatePath("/console/staff");
  if (staffId) revalidatePath(`/console/staff/${staffId}`);
}

export async function createStaffAccountAction(input: CreateStaffInput) {
  return runStaffAction(async () => {
    const session = await requireStaffAction("staff:manage");
    const parsed = createStaffSchema.parse(input);
    const { staff, setupLink } = await createStaffAccount(createAdminClient(), actor(session), {
      email: parsed.email,
      displayName: parsed.displayName,
      username: parsed.username,
      role: parsed.role as StaffRole,
    });
    await recordStaffAction(session, "staff.created", {
      targetType: "staff_member",
      targetId: staff.id,
      metadata: { role: staff.role, username: staff.username },
    });
    revalidateEmployee();
    return { setupLink, staffId: staff.id };
  });
}

export async function setStaffDisabledAction(staffId: string, disabled: boolean) {
  return runStaffAction(async () => {
    const session = await requireStaffAction("staff:manage");
    const updated = await setStaffDisabled(createAdminClient(), actor(session), staffIdSchema.parse(staffId), disabled === true);
    await recordStaffAction(session, disabled ? "staff.disabled" : "staff.enabled", {
      targetType: "staff_member",
      targetId: updated.id,
      metadata: { username: updated.username },
    });
    revalidateEmployee(updated.id);
    return null;
  });
}

export async function changeStaffRoleAction(staffId: string, role: StaffRole) {
  return runStaffAction(async () => {
    const session = await requireStaffAction("staff:manage");
    const parsed = changeStaffRoleSchema.parse({ staffId, role });
    const updated = await changeStaffRole(createAdminClient(), actor(session), parsed.staffId, parsed.role as StaffRole);
    await recordStaffAction(session, "staff.role_changed", {
      targetType: "staff_member",
      targetId: updated.id,
      metadata: { role: updated.role, username: updated.username },
    });
    revalidateEmployee(updated.id);
    return null;
  });
}

export async function resetStaffAccessAction(staffId: string) {
  return runStaffAction(async () => {
    const session = await requireStaffAction("staff:manage");
    const id = staffIdSchema.parse(staffId);
    const result = await resetStaffAccess(createAdminClient(), actor(session), id);
    await recordStaffAction(session, "staff.access_reset", { targetType: "staff_member", targetId: id });
    revalidateEmployee(id);
    return result;
  });
}

export async function setStaffPasswordAction(input: SetStaffPasswordInput) {
  return runStaffAction(async () => {
    const session = await requireStaffAction("staff:manage");
    const parsed = setStaffPasswordSchema.parse(input);
    const updated = await setStaffPassword(createAdminClient(), actor(session), parsed.staffId, parsed.password, parsed.mustChange);
    await recordStaffAction(session, "staff.password_set", {
      targetType: "staff_member",
      targetId: updated.id,
      metadata: { username: updated.username, mustChangeAtNextSignIn: parsed.mustChange },
    });
    revalidateEmployee(updated.id);
    return null;
  });
}

export async function changeStaffUsernameAction(staffId: string, username: string) {
  return runStaffAction(async () => {
    const session = await requireStaffAction("staff:manage");
    const parsed = changeUsernameSchema.parse({ staffId, username });
    const { staff, previous } = await changeStaffUsername(createAdminClient(), actor(session), parsed.staffId, parsed.username);
    if (previous !== staff.username) {
      await recordStaffAction(session, "staff.username_changed", {
        targetType: "staff_member",
        targetId: staff.id,
        metadata: { from: previous, to: staff.username },
      });
    }
    revalidateEmployee(staff.id);
    return null;
  });
}

export async function signOutStaffEverywhereAction(staffId: string) {
  return runStaffAction(async () => {
    const session = await requireStaffAction("staff:manage");
    const id = staffIdSchema.parse(staffId);
    const sessionsEnded = await signOutStaffEverywhere(createAdminClient(), actor(session), id);
    await recordStaffAction(session, "staff.signed_out_everywhere", { targetType: "staff_member", targetId: id, metadata: { sessionsEnded } });
    revalidateEmployee(id);
    return { sessionsEnded };
  });
}

export async function deleteStaffAccountAction(staffId: string, confirmUsername: string) {
  return runStaffAction(async () => {
    const session = await requireStaffAction("staff:manage");
    const id = staffIdSchema.parse(staffId);
    const deleted = await deleteStaffAccount(createAdminClient(), actor(session), id, String(confirmUsername ?? ""));
    // Who they were, so their earlier audit entries stay attributable.
    await recordStaffAction(session, "staff.deleted", {
      targetType: "staff_member",
      targetId: deleted.id,
      metadata: { username: deleted.username, displayName: deleted.display_name, role: deleted.role, userId: deleted.user_id },
    });
    revalidateEmployee();
    return null;
  });
}
