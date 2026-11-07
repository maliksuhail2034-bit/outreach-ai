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
import { normalizeUsername, STAFF_PASSWORD_POLICY_VERSION, staffPasswordProblems } from "./password-policy";
import { endStaffActivity } from "./work-session";

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
  url.searchParams.set("next", "/console/account?required=password");
  return url.toString();
}

export async function createStaffAccount(
  admin: Admin,
  actor: { userId: string; role: StaffRole },
  input: { email: string; displayName: string; username: string; role: StaffRole },
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
      username: normalizeUsername(input.username),
      status: "invited",
      // No password of their own yet: the setup link asks for one first.
      password_must_change: true,
      created_by: actor.userId,
    });
  } catch (insertError) {
    // Don't leave an auth user behind that isn't a staff member.
    await admin.auth.admin.deleteUser(created.user.id);
    if (isUniqueViolation(insertError)) throw new StaffAccountError("That username is already taken. Choose another.");
    throw insertError;
  }

  return { staff, setupLink: await issueSetupLink(admin, input.email) };
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}

async function loadManageableTarget(admin: Admin, actor: { userId: string; role: StaffRole }, staffId: string) {
  const target = await getStaffMember(admin, staffId);
  if (!target) throw new StaffAccountError("That staff account no longer exists.");
  if (target.status === "archived") throw new StaffAccountError("This account is archived. Add a new account to give them access again.");
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
  if (disabled) {
    await revokeUserSessions(admin, target.user_id);
    await endStaffActivity(target.id, "access_changed");
  }

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
  await endStaffActivity(target.id, "access_changed");
  await updateStaffMember(admin, target.id, { status: "invited", password_must_change: true });

  return { setupLink: await issueSetupLink(admin, await authEmail(admin, target.user_id)) };
}

// Sets an employee's password (e.g. they're locked out and can't receive a
// setup link). Checked against the target's role policy; every session ends.
// With mustChange (the console's default), they choose their own password at
// their next sign-in, so the operator never knows it for long.
export async function setStaffPassword(
  admin: Admin,
  actor: { userId: string; role: StaffRole },
  staffId: string,
  password: string,
  mustChange: boolean,
): Promise<Tables<"staff_members">> {
  const target = await loadManageableTarget(admin, actor, staffId);
  if (target.status === "disabled") throw new StaffAccountError("Unblock the account before setting its password.");
  const problems = staffPasswordProblems(target.role as StaffRole, password, { username: target.username });
  if (problems.length > 0) throw new StaffAccountError(problems[0]);

  const { error } = await admin.auth.admin.updateUserById(target.user_id, { password });
  if (error) throw new StaffAccountError("Couldn't set the password. Try a different one.");
  await revokeUserSessions(admin, target.user_id);
  await endStaffActivity(target.id, "access_changed");
  return updateStaffMember(admin, target.id, {
    password_must_change: mustChange,
    password_policy_version: STAFF_PASSWORD_POLICY_VERSION,
    password_changed_at: new Date().toISOString(),
  });
}

async function renameStaff(admin: Admin, target: Tables<"staff_members">, username: string) {
  const next = normalizeUsername(username);
  if (next === target.username) return { staff: target, previous: target.username };
  try {
    return { staff: await updateStaffMember(admin, target.id, { username: next }), previous: target.username };
  } catch (error) {
    if (isUniqueViolation(error)) throw new StaffAccountError("That username is already taken. Choose another.");
    throw error;
  }
}

export async function changeStaffUsername(
  admin: Admin,
  actor: { userId: string; role: StaffRole },
  staffId: string,
  username: string,
): Promise<{ staff: Tables<"staff_members">; previous: string }> {
  const target = await loadManageableTarget(admin, actor, staffId);
  return renameStaff(admin, target, username);
}

// Ends every session of an employee (lost laptop, suspicious activity)
// without blocking the account.
export async function signOutStaffEverywhere(admin: Admin, actor: { userId: string; role: StaffRole }, staffId: string): Promise<number> {
  const target = await loadManageableTarget(admin, actor, staffId);
  const ended = await revokeUserSessions(admin, target.user_id);
  await endStaffActivity(target.id, "access_changed");
  return ended;
}

// A leaver: sign-in is refused for good and every session ends, but the
// record, work sessions and audit trail stay (payroll, disputes). Permanent
// from the console — rehiring means a new account.
export async function archiveStaffAccount(
  admin: Admin,
  actor: { userId: string; role: StaffRole },
  staffId: string,
  confirmUsername: string,
): Promise<Tables<"staff_members">> {
  const target = await loadManageableTarget(admin, actor, staffId);
  if (normalizeUsername(confirmUsername) !== target.username) throw new StaffAccountError("Type the username exactly to confirm.");
  await assertNotLastOwner(admin, target);

  const { error } = await admin.auth.admin.updateUserById(target.user_id, { ban_duration: BAN_FOREVER });
  if (error) throw new StaffAccountError("Couldn't block the account's sign-in. Try again.");
  await revokeUserSessions(admin, target.user_id);
  await endStaffActivity(target.id, "access_changed");
  return updateStaffMember(admin, target.id, { status: "archived", archived_at: new Date().toISOString(), archived_by: actor.userId });
}

// --- The signed-in staff member's own account -----------------------------------------

// `updateOwnPassword` changes the password through the person's own session
// (supabase.auth.updateUser). The admin API would also end the session
// they're using, signing them out in the middle of first-time setup.
export async function setOwnPassword(
  admin: Admin,
  staff: Tables<"staff_members">,
  email: string | null,
  password: string,
  updateOwnPassword: (password: string) => Promise<{ error: { message: string } | null }>,
): Promise<void> {
  const problems = staffPasswordProblems(staff.role as StaffRole, password, { username: staff.username, email: email ?? undefined });
  if (problems.length > 0) throw new StaffAccountError(problems[0]);
  const { error } = await updateOwnPassword(password);
  if (error) {
    throw new StaffAccountError(
      /different from the old/i.test(error.message) ? "Choose a password you haven't used before." : "Couldn't save that password. Try a different one.",
    );
  }
  await updateStaffMember(admin, staff.id, {
    password_must_change: false,
    password_policy_version: STAFF_PASSWORD_POLICY_VERSION,
    password_changed_at: new Date().toISOString(),
  });
}

export async function changeOwnUsername(admin: Admin, staff: Tables<"staff_members">, username: string) {
  return renameStaff(admin, staff, username);
}

