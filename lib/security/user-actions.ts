import { isIP } from "node:net";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database.types";
import { getStaffMemberByUserId, revokeUserSessions, type StaffRole } from "@/lib/db";
import { canManageStaffRole, isStaffRole } from "@/lib/staff/permissions";
import { StaffInputError } from "@/lib/staff/run-action";
import { buildBlockList, isIpBlocked } from "./ip-blocklist";

type Admin = SupabaseClient<Database>;

interface Actor {
  userId: string;
  role: StaffRole;
}

// ~100 years: Supabase Auth has no "forever"; a ban this long is a lock
// until someone unlocks it.
const LOCK_DURATION = "876000h";

// Who may act on an account from the security panel: never yourself (no
// self-lockout), and a staff account only if the actor may manage that
// staff role — so security can't lock or sign out an owner.
export async function assertCanActOnUser(admin: Admin, actor: Actor, targetUserId: string): Promise<void> {
  if (targetUserId === actor.userId) throw new StaffInputError("You can't do this to your own account.");
  const staff = await getStaffMemberByUserId(admin, targetUserId);
  if (staff && isStaffRole(staff.role) && !canManageStaffRole(actor.role, staff.role)) {
    throw new StaffInputError("Only an owner can act on an owner account.");
  }
}

// Lock = ban in Supabase Auth (sign-in refused) + every session ended, so
// an already signed-in attacker is out once their access token expires.
export async function lockUser(admin: Admin, actor: Actor, targetUserId: string): Promise<{ sessionsEnded: number }> {
  await assertCanActOnUser(admin, actor, targetUserId);
  const { error } = await admin.auth.admin.updateUserById(targetUserId, { ban_duration: LOCK_DURATION });
  if (error) throw error;
  return { sessionsEnded: await revokeUserSessions(admin, targetUserId) };
}

export async function unlockUser(admin: Admin, actor: Actor, targetUserId: string): Promise<void> {
  await assertCanActOnUser(admin, actor, targetUserId);
  const { error } = await admin.auth.admin.updateUserById(targetUserId, { ban_duration: "none" });
  if (error) throw error;
}

export async function signOutEverywhere(admin: Admin, actor: Actor, targetUserId: string): Promise<{ sessionsEnded: number }> {
  await assertCanActOnUser(admin, actor, targetUserId);
  return { sessionsEnded: await revokeUserSessions(admin, targetUserId) };
}

// Narrowest ranges allowed: anything broader would block whole providers
// or countries and should be done at the firewall (CrowdSec), not here.
const MIN_PREFIX = { 4: 8, 6: 32 } as const;

// Validates and normalizes an address or CIDR range for ip_blocklist, and
// refuses one that would block the operator's own current address.
export function normalizeIpBlock(raw: string, actorIp: string | null): string {
  const [address, prefixText, extra] = raw.trim().split("/");
  const version = isIP(address ?? "");
  if (extra !== undefined || (version !== 4 && version !== 6)) {
    throw new StaffInputError("Enter an IPv4 or IPv6 address, or a range like 203.0.113.0/24.");
  }
  let cidr = address;
  if (prefixText !== undefined) {
    const prefix = Number(prefixText);
    const max = version === 4 ? 32 : 128;
    if (!/^\d{1,3}$/.test(prefixText) || prefix > max) throw new StaffInputError(`The range size must be 0–${max}.`);
    if (prefix < MIN_PREFIX[version]) {
      throw new StaffInputError(`That range is too broad (narrowest allowed is /${MIN_PREFIX[version]}). Block it at the firewall instead.`);
    }
    cidr = `${address}/${prefix}`;
  }
  if (actorIp && isIpBlocked(buildBlockList([{ cidr }]), actorIp)) {
    throw new StaffInputError("That would block your own current address.");
  }
  return cidr;
}
