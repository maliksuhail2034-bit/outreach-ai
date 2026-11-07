"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { deleteIpBlock, insertIpBlock, updateGrcControl } from "@/lib/db";
import { requireStaffAction } from "@/lib/staff/auth";
import { recordStaffAction } from "@/lib/staff/audit";
import { runStaffAction, StaffInputError } from "@/lib/staff/run-action";
import { getClientIp } from "@/lib/rate-limit/get-client-ip";
import { lockUser, normalizeIpBlock, signOutEverywhere, unlockUser } from "@/lib/security/user-actions";
import {
  grcControlUpdateSchema,
  ipBlockSchema,
  recordIdSchema,
  userIdSchema,
  type GrcControlUpdateInput,
  type IpBlockInput,
} from "@/lib/validations/staff";

// Every action re-checks the caller's staff role, permission and 2-step
// login itself (Server Functions are reachable by direct POST), validates
// its input, and writes the staff audit log on success.

function actorOf(session: Awaited<ReturnType<typeof requireStaffAction>>) {
  return { userId: session.user.id, role: session.role };
}

export async function lockUserAction(userId: string) {
  return runStaffAction(async () => {
    const session = await requireStaffAction("security:act");
    const targetId = userIdSchema.parse(userId);
    const result = await lockUser(createAdminClient(), actorOf(session), targetId);
    await recordStaffAction(session, "user.locked", { targetType: "user", targetId, metadata: { sessionsEnded: result.sessionsEnded } });
    revalidatePath("/console/security/users");
    return result;
  });
}

export async function unlockUserAction(userId: string) {
  return runStaffAction(async () => {
    const session = await requireStaffAction("security:act");
    const targetId = userIdSchema.parse(userId);
    await unlockUser(createAdminClient(), actorOf(session), targetId);
    await recordStaffAction(session, "user.unlocked", { targetType: "user", targetId });
    revalidatePath("/console/security/users");
    return null;
  });
}

export async function signOutEverywhereAction(userId: string) {
  return runStaffAction(async () => {
    const session = await requireStaffAction("security:act");
    const targetId = userIdSchema.parse(userId);
    const result = await signOutEverywhere(createAdminClient(), actorOf(session), targetId);
    await recordStaffAction(session, "user.signed_out_everywhere", {
      targetType: "user",
      targetId,
      metadata: { sessionsEnded: result.sessionsEnded },
    });
    revalidatePath("/console/security/users");
    return result;
  });
}

export async function blockIpAction(input: IpBlockInput) {
  return runStaffAction(async () => {
    const session = await requireStaffAction("security:act");
    const parsed = ipBlockSchema.parse(input);
    const ip = await getClientIp();
    const cidr = normalizeIpBlock(parsed.cidr, ip === "unknown" ? null : ip);
    const expiresAt = parsed.expiresInHours ? new Date(Date.now() + parsed.expiresInHours * 3_600_000).toISOString() : null;
    let block;
    try {
      block = await insertIpBlock(createAdminClient(), { cidr, reason: parsed.reason, expires_at: expiresAt, created_by: session.user.id });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") throw new StaffInputError("That address or range is already blocked.");
      throw error;
    }
    await recordStaffAction(session, "ip.blocked", {
      targetType: "ip_block",
      targetId: block.id,
      metadata: { cidr, expiresAt, reason: parsed.reason },
    });
    revalidatePath("/console/security/ip-blocks");
    revalidatePath("/console/security");
    return null;
  });
}

export async function unblockIpAction(blockId: string) {
  return runStaffAction(async () => {
    const session = await requireStaffAction("security:act");
    const id = recordIdSchema.parse(blockId);
    const cidr = await deleteIpBlock(createAdminClient(), id);
    if (!cidr) throw new StaffInputError("That block no longer exists.");
    await recordStaffAction(session, "ip.unblocked", { targetType: "ip_block", targetId: id, metadata: { cidr } });
    revalidatePath("/console/security/ip-blocks");
    revalidatePath("/console/security");
    return null;
  });
}

export async function updateGrcControlAction(input: GrcControlUpdateInput) {
  return runStaffAction(async () => {
    const session = await requireStaffAction("grc:edit");
    const parsed = grcControlUpdateSchema.parse(input);
    const control = await updateGrcControl(createAdminClient(), parsed.id, {
      status: parsed.status,
      notes: parsed.notes,
      updated_by: session.user.id,
    });
    await recordStaffAction(session, "grc.updated", {
      targetType: "grc_control",
      targetId: control.id,
      metadata: { control: control.control_key, status: parsed.status },
    });
    revalidatePath("/console/security/grc");
    return null;
  });
}
