// Staff sessions end after 30 minutes without activity (pages, actions, or
// the console's in-page heartbeat while the person is using it). Pure, so the
// rule is unit-tested; lib/staff/auth.ts enforces it on every console page
// and Server Function, and components/console/console-presence.tsx signs the
// browser out at the same moment.

export const STAFF_IDLE_TIMEOUT_MS = 30 * 60_000;

// Idle is measured from the later of the last recorded activity and the last
// password sign-in, so signing in again after a long break never counts as
// idle.
export function isStaffIdle(
  times: { lastSeenAt: string | null; lastSignInAt: string | null | undefined },
  now: number = Date.now(),
): boolean {
  const lastActivity = Math.max(
    times.lastSeenAt ? Date.parse(times.lastSeenAt) : 0,
    times.lastSignInAt ? Date.parse(times.lastSignInAt) : 0,
  );
  if (!lastActivity) return false;
  return now - lastActivity > STAFF_IDLE_TIMEOUT_MS;
}
