import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, CalendarClockIcon, ClockIcon, ListChecksIcon, TimerIcon } from "lucide-react";

import { createAdminClient } from "@/lib/supabase/admin";
import { getStaffMember, listAuthEventsForUser, listStaffActionsSince, listStaffWorkSessions, listUsersWithVerifiedMfa, type StaffRole } from "@/lib/db";
import { requireStaffPage } from "@/lib/staff/auth";
import { canManageStaffRole, isStaffRole, STAFF_ROLE_LABELS } from "@/lib/staff/permissions";
import { isBanned } from "@/lib/staff/directory";
import { ACTION_LABELS, formatDuration, sessionBounds, workDone, workTotals } from "@/lib/staff/work";
import { hashSignInEmail } from "@/lib/security/auth-events";
import { staffIdSchema } from "@/lib/validations/staff";
import { DailyBarChart } from "@/components/analytics/daily-bar-chart";
import { EmployeeActions } from "@/components/console/employee-actions";
import { PageHeader } from "@/components/console/page-header";
import { StatCard, StatGrid } from "@/components/console/stat-card";
import { STAFF_STATUS_LABELS as STATUS_LABELS, STAFF_STATUS_VARIANT as STATUS_VARIANT } from "@/lib/staff/status";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const DAY_MS = 86_400_000;
const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
const fmt = (value: string | null | undefined) => (value ? `${dateTime.format(new Date(value))} UTC` : "—");

const EVENT_LABELS: Record<string, string> = {
  sign_in_success: "Signed in",
  sign_in_failure: "Failed sign-in",
  sign_in_rate_limited: "Blocked (too many attempts)",
};

export default async function EmployeePage({ params }: { params: Promise<{ staffId: string }> }) {
  const session = await requireStaffPage("staff:view");
  const parsed = staffIdSchema.safeParse((await params).staffId);
  if (!parsed.success) notFound();

  const admin = createAdminClient();
  const staff = await getStaffMember(admin, parsed.data);
  if (!staff || !isStaffRole(staff.role)) notFound();
  const role = staff.role as StaffRole;

  const now = new Date();
  const since = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const { data: authUser } = await admin.auth.admin.getUserById(staff.user_id);
  const user = authUser.user;
  const failureHashes = [hashSignInEmail(`staff:${staff.username}`), ...(user?.email ? [hashSignInEmail(user.email)] : [])];

  const [sessions, actions, signIns, creator, withMfa] = await Promise.all([
    listStaffWorkSessions(admin, staff.id, since),
    listStaffActionsSince(admin, staff.user_id, since),
    listAuthEventsForUser(admin, staff.user_id, since, failureHashes, 25),
    staff.created_by ? admin.auth.admin.getUserById(staff.created_by).then(({ data }) => data.user?.email ?? null) : Promise.resolve(null),
    listUsersWithVerifiedMfa(admin, [staff.user_id]),
  ]);

  const totals = workTotals(sessions, now);
  const done = workDone(actions);
  const isSelf = staff.user_id === session.user.id;
  const canManage = !isSelf && canManageStaffRole(session.role, role);
  const mfa = withMfa.has(staff.user_id);
  const locked = user ? isBanned(user) : false;

  return (
    <div className="space-y-6">
      <Link href="/console/staff" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" aria-hidden="true" />
        Employees
      </Link>

      <PageHeader
        title={staff.display_name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="font-mono">{staff.username}</span>
            <span aria-hidden="true">·</span>
            {STAFF_ROLE_LABELS[role]}
            <Badge variant={STATUS_VARIANT[staff.status as keyof typeof STATUS_VARIANT] ?? "secondary"}>
              {STATUS_LABELS[staff.status as keyof typeof STATUS_LABELS] ?? staff.status}
            </Badge>
            {isSelf && <span>(you)</span>}
          </span>
        }
        actions={
          isSelf ? (
            <Link href="/console/account" className="text-sm font-medium text-primary hover:underline">
              Change your password or username
            </Link>
          ) : undefined
        }
      />

      <StatGrid>
        <StatCard label="Worked today" icon={ClockIcon} value={formatDuration(totals.todaySeconds)} hint="UTC day" />
        <StatCard label="Last 7 days" icon={TimerIcon} value={formatDuration(totals.weekSeconds)} />
        <StatCard label="Last 30 days" icon={CalendarClockIcon} value={formatDuration(totals.monthSeconds)} hint={`${totals.sessionsThisMonth} sessions`} />
        <StatCard label="Actions (30 days)" icon={ListChecksIcon} value={actions.length.toLocaleString()} />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <DailyBarChart
            title="Minutes worked per day"
            description="Last 14 days (UTC). Time with the console open and in use; a session ends after 15 idle minutes or at sign-out."
            data={totals.daily.map((day) => ({ date: day.date, value: Math.round(day.seconds / 60) }))}
            barClassName="bg-primary"
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Work done (30 days)</CardTitle>
              <CardDescription>From the staff audit log: everything this person changed in the console.</CardDescription>
            </CardHeader>
            <CardContent>
              {done.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recorded actions in the last 30 days.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th scope="col" className="py-2 pr-4 font-medium">Action</th>
                      <th scope="col" className="py-2 pr-4 text-right font-medium">Times</th>
                      <th scope="col" className="py-2 text-right font-medium">Items</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {done.map((row) => (
                      <tr key={row.action}>
                        <td className="py-2 pr-4">{row.label}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{row.count.toLocaleString()}</td>
                        <td className="py-2 text-right text-muted-foreground tabular-nums">{row.items === null ? "—" : row.items.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent actions</CardTitle>
              <CardDescription>The latest 15. The full trail is in Security center → Audit log.</CardDescription>
            </CardHeader>
            <CardContent>
              {actions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing yet.</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {actions.slice(0, 15).map((entry) => (
                    <li key={entry.seq} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
                      <span>{ACTION_LABELS[entry.action] ?? entry.action}</span>
                      <span className="text-xs whitespace-nowrap text-muted-foreground">{fmt(entry.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {canManage && (
            <EmployeeActions
              staffId={staff.id}
              displayName={staff.display_name}
              username={staff.username}
              role={role}
              status={staff.status as "invited" | "active" | "disabled"}
              assignableRoles={(["owner", "security", "sales"] as const).filter((candidate) => canManageStaffRole(session.role, candidate))}
            />
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Account</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Email</dt>
                <dd className="truncate">{user?.email ?? "—"}</dd>
                <dt className="text-muted-foreground">2-step login</dt>
                <dd>{mfa ? "On" : "Not set up"}</dd>
                <dt className="text-muted-foreground">Sign-in</dt>
                <dd>{locked ? "Blocked" : "Allowed"}</dd>
                <dt className="text-muted-foreground">Password set</dt>
                <dd>{fmt(staff.password_changed_at)}{staff.password_must_change ? " (must change)" : ""}</dd>
                <dt className="text-muted-foreground">Last sign-in</dt>
                <dd>{fmt(user?.last_sign_in_at)}</dd>
                <dt className="text-muted-foreground">Last active</dt>
                <dd>{fmt(staff.last_seen_at)}</dd>
                <dt className="text-muted-foreground">Added</dt>
                <dd>
                  {fmt(staff.created_at)}
                  {creator && <span className="block text-xs text-muted-foreground">by {creator}</span>}
                </dd>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Work sessions</CardTitle>
              <CardDescription>Latest 10.</CardDescription>
            </CardHeader>
            <CardContent>
              {sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sessions in the last 30 days.</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {sessions.slice(0, 10).map((row) => {
                    const { start, end } = sessionBounds(row);
                    return (
                      <li key={row.id} className="flex items-baseline justify-between gap-3 py-2">
                        <span className="text-xs text-muted-foreground">
                          {fmt(row.started_at)}
                          {row.country && ` · ${row.country}`}
                          {row.ended_at === null && " · open"}
                        </span>
                        <span className="tabular-nums">{formatDuration((end - start) / 1000)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Sign-ins (30 days)</CardTitle>
            </CardHeader>
            <CardContent>
              {signIns.length === 0 ? (
                <p className="text-sm text-muted-foreground">None recorded.</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {signIns.slice(0, 10).map((event, index) => (
                    <li key={`${event.created_at}-${index}`} className="flex items-baseline justify-between gap-3 py-2">
                      <span className={event.event_type === "sign_in_success" ? "" : "text-destructive"}>{EVENT_LABELS[event.event_type] ?? event.event_type}</span>
                      <span className="text-right text-xs text-muted-foreground">
                        {fmt(event.created_at)}
                        <span className="block">{[event.country, event.ip].filter(Boolean).join(" · ") || "—"}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
