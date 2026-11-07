import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import type { Tables } from "@/types/database.types";
import { getUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStaffMemberByUserId, updateStaffMember, type StaffRole } from "@/lib/db/staff";
import { hasStaffPermission, isStaffRole, type StaffPermission } from "./permissions";

// The staff console's authorization boundary. Every console page calls
// requireStaffPage() and every console Server Function calls
// requireStaffAction() itself — Server Functions are reachable by direct
// POST, so no action relies on the page having checked (CLAUDE.md §4).
//
// A staff session requires, all at once:
//   1. a signed-in user with an active (or just-invited) staff_members row —
//      the table is the authority, not the JWT's app_metadata flag;
//   2. 2-step login completed in this session (Supabase aal2);
//   3. the role's permission for what is being done.

export type StaffMfaState = "verified" | "needs_enrollment" | "needs_verification";

export interface StaffSession {
  user: User;
  staff: Tables<"staff_members">;
  role: StaffRole;
  mfa: StaffMfaState;
}

export class StaffAccessError extends Error {
  constructor(message = "You don't have access to do that.") {
    super(message);
    this.name = "StaffAccessError";
  }
}

const LAST_SEEN_THROTTLE_MS = 5 * 60_000;

export function mfaStateFrom(currentLevel: string | null, nextLevel: string | null): StaffMfaState {
  if (currentLevel === "aal2") return "verified";
  return nextLevel === "aal2" ? "needs_verification" : "needs_enrollment";
}

// Request-scoped (React cache): one staff lookup and one assurance-level
// read per request, however many components ask.
export const getStaffSession = cache(async (): Promise<StaffSession | null> => {
  const user = await getUser();
  if (!user) return null;

  const staff = await getStaffMemberByUserId(createAdminClient(), user.id);
  if (!staff || staff.status === "disabled" || !isStaffRole(staff.role)) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;

  return { user, staff, role: staff.role, mfa: mfaStateFrom(data.currentLevel, data.nextLevel) };
});

// First fully verified visit turns an invited account active; afterwards
// last_seen_at is refreshed at most every few minutes.
async function markSeen(session: StaffSession): Promise<void> {
  const last = session.staff.last_seen_at ? new Date(session.staff.last_seen_at).getTime() : 0;
  if (session.staff.status === "active" && Date.now() - last < LAST_SEEN_THROTTLE_MS) return;
  await updateStaffMember(createAdminClient(), session.staff.id, {
    status: "active",
    last_seen_at: new Date().toISOString(),
  });
}

// For console pages. Signed out -> sign in; signed in but not staff -> 404
// (the console's existence isn't advertised); 2-step login pending -> the
// 2-step pages; missing permission -> console home.
export async function requireStaffPage(permission?: StaffPermission): Promise<StaffSession> {
  const user = await getUser();
  if (!user) redirect("/login");

  const session = await getStaffSession();
  if (!session) notFound();
  if (session.mfa === "needs_enrollment") redirect("/console/2fa/setup");
  if (session.mfa === "needs_verification") redirect("/console/2fa/verify");
  if (permission && !hasStaffPermission(session.role, permission)) redirect("/console");

  await markSeen(session);
  return session;
}

// For console Server Functions: same checks, thrown instead of redirected.
export async function requireStaffAction(permission: StaffPermission): Promise<StaffSession> {
  const session = await getStaffSession();
  if (!session) throw new StaffAccessError("Sign in with a staff account.");
  if (session.mfa !== "verified") throw new StaffAccessError("Complete 2-step login first.");
  if (!hasStaffPermission(session.role, permission)) throw new StaffAccessError();
  return session;
}

// For the 2-step login pages, which must work before aal2.
export async function requireStaffPendingMfa(): Promise<StaffSession> {
  const user = await getUser();
  if (!user) redirect("/login");
  const session = await getStaffSession();
  if (!session) notFound();
  return session;
}
