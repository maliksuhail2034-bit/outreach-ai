import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Tables } from "@/types/database.types";
import { appUrl } from "@/lib/app-url";
import {
  countActiveOwners,
  getStaffMember,
  insertStaffMember,
  revokeUserSessions,
  updateStaffMember,
  type StaffRole,
} from "@/lib/db";
import { canManageStaffRole } from "./permissions";

// Staff account lifecycle, shared by the console's Server Functions and the
// owner bootstrap script. The caller has already authorized the actor
// (requireStaffAction("staff:manage")); every function here still enforces
// the role rules itself (who may create/change/disable whom).

type Admin = SupabaseClient<Database>;

// Anything the operator should see verbatim (returned, not thrown, by the
// Server Functions so production builds don't redact it).
export class StaffAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffAccountError";
  }
}

const BAN_FOREVER = "876000h"; // ~100 years

// A single-use link that signs the person in and lands on "set your
// password"; from there the console requires 2-step login setup. Built from
// a Supabase recovery token issued by the admin API, which sends no email —
// the operator hands the link over. It expires per the project's email OTP
// expiry (1 hour by default) and is never stored or logged.
export async function issueSetupLink(admin: Admin, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
  if (error || !data.properties?.hashed_token) {
    throw new StaffAccountError("Couldn't create a setup link. Try again.");
  }
  const url = appUrl("/auth/confirm");
  url.searchParams.set("token_hash", data.properties.hashed_token);
  url.searchParams.set("type", "recovery");
  url.searchParams.set("next", "/reset-password");
  return url.toString();
}

export async function createStaffAccount(
  admin: Admin,
  actor: { userId: string; role: StaffRole },
  input: { email: string; displayName: string; role: StaffRole },
): Promise<{ staff: Tables<"staff_members">; setupLink: string }> {
  if (!canManageStaffRole(actor.role, input.role)) {
    throw new StaffAccountError(`Your role can't create ${input.role} accounts.`);
  }

  const { data: created, error } = await admin.auth.admin.createUser({
    email: input.email,
    email_confirm: true,
    // Service-role-only claim, read by the customer app layout to route
    // staff to the console. staff_members stays the authority.
    app_metadata: { polimatiq_staff: true },
    user_metadata: { full_name: input.displayName },
  });
  if (error || !created.user) {
    const exists = error && /already|registered|exists/i.test(error.message);
    throw new StaffAccountError(
      exists
        ? "That email already has a Polimatiq account. Staff accounts must use their own, separate address."
        : "Couldn't create the account. Try again.",
    );
  }

  let staff: Tables<"staff_members">;
  try {
    staff = await insertStaffMember(admin, {
      user_id: created.user.id,
      role: input.role,
      display_name: input.displayName,
      status: "invited",
      created_by: actor.userId,
    });
  } catch (insertError) {
    // Don't leave an auth user behind that isn't a staff member.
    await admin.auth.admin.deleteUser(created.user.id);
    throw insertError;
  }

  return { staff, setupLink: await issueSetupLink(admin, input.email) };
}

async function loadManageableTarget(admin: Admin, actor: { userId: string; role: StaffRole }, staffId: string) {
  const target = await getStaffMember(admin, staffId);
  if (!target) throw new StaffAccountError("That staff account no longer exists.");
  if (target.user_id === actor.userId) throw new StaffAccountError("You can't change your own staff account here.");
  if (!canManageStaffRole(actor.role, target.role as StaffRole)) {
    throw new StaffAccountError(`Your role can't manage ${target.role} accounts.`);
  }
  return target;
}

async function assertNotLastOwner(admin: Admin, target: Tables<"staff_members">) {
  if (target.role === "owner" && target.status === "active" && (await countActiveOwners(admin)) <= 1) {
    throw new StaffAccountError("This is the only active owner. Add another owner first.");
  }
}

async function authEmail(admin: Admin, userId: string): Promise<string> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user?.email) throw new StaffAccountError("Couldn't load that account.");
  return data.user.email;
}

// Disabling locks the sign-in (ban) and ends every session immediately;
// re-enabling lifts the ban. The row is kept, so history stays attributable.
export async function setStaffDisabled(
  admin: Admin,
  actor: { userId: string; role: StaffRole },
  staffId: string,
  disabled: boolean,
): Promise<Tables<"staff_members">> {
  const target = await loadManageableTarget(admin, actor, staffId);
  if (disabled) await assertNotLastOwner(admin, target);

  const { error } = await admin.auth.admin.updateUserById(target.user_id, { ban_duration: disabled ? BAN_FOREVER : "none" });
  if (error) throw new StaffAccountError("Couldn't update the account's sign-in.");
  if (disabled) await revokeUserSessions(admin, target.user_id);

  return updateStaffMember(admin, target.id, { status: disabled ? "disabled" : "invited" });
}

export async function changeStaffRole(
  admin: Admin,
  actor: { userId: string; role: StaffRole },
  staffId: string,
  role: StaffRole,
): Promise<Tables<"staff_members">> {
  const target = await loadManageableTarget(admin, actor, staffId);
  if (!canManageStaffRole(actor.role, role)) throw new StaffAccountError(`Your role can't grant ${role}.`);
  if (target.role === role) return target;
  if (target.role === "owner") await assertNotLastOwner(admin, target);

  const updated = await updateStaffMember(admin, target.id, { role });
  // The new role applies on the next request anyway (the table is checked
  // every time); ending sessions makes the change unmistakable.
  await revokeUserSessions(admin, target.user_id);
  return updated;
}

// "Lost phone / compromised account": removes every 2-step factor, ends all
// sessions and issues a fresh setup link, so the person must set a new
// password and enroll a new authenticator.
export async function resetStaffAccess(
  admin: Admin,
  actor: { userId: string; role: StaffRole },
  staffId: string,
): Promise<{ setupLink: string }> {
  const target = await loadManageableTarget(admin, actor, staffId);
  if (target.status === "disabled") throw new StaffAccountError("Enable the account before resetting its access.");

  const { data: factors, error } = await admin.auth.admin.mfa.listFactors({ userId: target.user_id });
  if (error) throw new StaffAccountError("Couldn't read the account's 2-step login.");
  for (const factor of factors?.factors ?? []) {
    await admin.auth.admin.mfa.deleteFactor({ userId: target.user_id, id: factor.id });
  }
  await revokeUserSessions(admin, target.user_id);
  await updateStaffMember(admin, target.id, { status: "invited" });

  return { setupLink: await issueSetupLink(admin, await authEmail(admin, target.user_id)) };
}
