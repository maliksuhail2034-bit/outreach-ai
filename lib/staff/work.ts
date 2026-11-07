// Hours worked and work done for one staff member, computed from their
// staff_work_sessions rows and staff_audit_log entries. Pure, so every rule
// is unit-tested; the employee page loads the rows and renders the result.

const DAY_MS = 86_400_000;

export interface WorkSessionRow {
  started_at: string;
  last_activity_at: string;
  ended_at: string | null;
}

// A session counts from its start to when it ended, or — while still open —
// to its last recorded activity (never to "now": an abandoned tab isn't work).
export function sessionBounds(session: WorkSessionRow): { start: number; end: number } {
  const start = Date.parse(session.started_at);
  const end = Date.parse(session.ended_at ?? session.last_activity_at);
  return { start, end: Math.max(start, end) };
}

export function secondsBetween(session: WorkSessionRow, from: number, to: number): number {
  const { start, end } = sessionBounds(session);
  const overlap = Math.min(end, to) - Math.max(start, from);
  return overlap > 0 ? Math.round(overlap / 1000) : 0;
}

export interface WorkTotals {
  todaySeconds: number;
  weekSeconds: number;
  monthSeconds: number;
  sessionsThisMonth: number;
  // Last 14 UTC days, oldest first.
  daily: { date: string; seconds: number }[];
}

export function workTotals(sessions: readonly WorkSessionRow[], now: Date = new Date()): WorkTotals {
  const nowMs = now.getTime();
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const sum = (from: number) => sessions.reduce((total, session) => total + secondsBetween(session, from, nowMs), 0);
  const daily = Array.from({ length: 14 }, (_, index) => {
    const from = todayStart - (13 - index) * DAY_MS;
    return {
      date: new Date(from).toISOString().slice(0, 10),
      seconds: sessions.reduce((total, session) => total + secondsBetween(session, from, from + DAY_MS), 0),
    };
  });
  return {
    todaySeconds: sum(todayStart),
    weekSeconds: sum(nowMs - 7 * DAY_MS),
    monthSeconds: sum(nowMs - 30 * DAY_MS),
    sessionsThisMonth: sessions.filter((session) => sessionBounds(session).end > nowMs - 30 * DAY_MS).length,
    daily,
  };
}

// "3 h 25 min", "45 min", "0 min".
export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

// --- Work done ---------------------------------------------------------------------

// Plain-language names for audit actions. Anything unlisted is shown by its
// raw action name, so a new action never disappears from the summary.
export const ACTION_LABELS: Record<string, string> = {
  "leads.uploaded": "Lead batches uploaded",
  "leads.status_retired": "Pool leads retired",
  "leads.status_active": "Pool leads reactivated",
  "allocation.run": "Allocations run",
  "quota.updated": "Plan quotas changed",
  "user.locked": "Customer accounts locked",
  "user.unlocked": "Customer accounts unlocked",
  "user.signed_out_everywhere": "Customers signed out everywhere",
  "ip.blocked": "Addresses blocked",
  "ip.unblocked": "Addresses unblocked",
  "grc.updated": "Compliance controls updated",
  "staff.created": "Employees added",
  "staff.deleted": "Employees deleted",
  "staff.disabled": "Employees blocked",
  "staff.enabled": "Employees unblocked",
  "staff.role_changed": "Employee roles changed",
  "staff.access_reset": "Employee access reset",
  "staff.password_set": "Employee passwords set",
  "staff.username_changed": "Employee usernames changed",
  "staff.signed_out_everywhere": "Employees signed out everywhere",
  "staff.password_changed": "Own password changed",
  "staff.own_username_changed": "Own username changed",
  "staff.mfa_enrolled": "2-step login set up",
};

export interface WorkDoneRow {
  action: string;
  label: string;
  count: number;
  // Extra volume where the action carries it (e.g. leads in uploaded batches).
  items: number | null;
}

export function workDone(actions: readonly { action: string; metadata: unknown }[]): WorkDoneRow[] {
  const rows = new Map<string, WorkDoneRow>();
  for (const entry of actions) {
    const row = rows.get(entry.action) ?? { action: entry.action, label: ACTION_LABELS[entry.action] ?? entry.action, count: 0, items: null };
    row.count += 1;
    const metadata = entry.metadata && typeof entry.metadata === "object" ? (entry.metadata as Record<string, unknown>) : {};
    const volume = typeof metadata.inserted === "number" ? metadata.inserted : typeof metadata.count === "number" ? metadata.count : null;
    if (volume !== null) row.items = (row.items ?? 0) + volume;
    rows.set(entry.action, row);
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
