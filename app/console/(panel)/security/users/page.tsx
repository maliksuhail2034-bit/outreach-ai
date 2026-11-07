import Link from "next/link";

import { createAdminClient } from "@/lib/supabase/admin";
import { listStaffMembers } from "@/lib/db";
import { requireStaffPage } from "@/lib/staff/auth";
import { isBanned, listAuthUsers } from "@/lib/staff/directory";
import { canManageStaffRole, hasStaffPermission, isStaffRole, STAFF_ROLE_LABELS } from "@/lib/staff/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { UserSecurityActions } from "@/components/console/user-security-actions";

const PAGE_SIZE = 50;
const dateFormatter = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

function formatDate(value: string | null | undefined) {
  return value ? `${dateFormatter.format(new Date(value))} UTC` : "—";
}

export default async function SecurityUsersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const session = await requireStaffPage("security:view");
  const { q = "", page: pageParam } = await searchParams;
  const query = q.trim().toLowerCase().slice(0, 254);
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  const admin = createAdminClient();
  const [users, staff] = await Promise.all([listAuthUsers(admin), listStaffMembers(admin)]);
  const staffByUserId = new Map(staff.map((member) => [member.user_id, member]));
  const canAct = hasStaffPermission(session.role, "security:act");

  const matching = users
    .filter((user) => !query || (user.email ?? "").toLowerCase().includes(query))
    .sort((a, b) => (b.last_sign_in_at ?? "").localeCompare(a.last_sign_in_at ?? ""));
  const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const rows = matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const lockedCount = users.filter((user) => isBanned(user)).length;

  function pageHref(next: number) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (next > 1) params.set("page", String(next));
    const search = params.toString();
    return `/console/security/users${search ? `?${search}` : ""}`;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Users</CardTitle>
        <CardDescription>
          {users.length.toLocaleString()} accounts · {lockedCount} locked. Locking refuses sign-in and ends every session; sign out everywhere only ends sessions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="flex max-w-md gap-2" role="search">
          <label htmlFor="user-search" className="sr-only">
            Search by email
          </label>
          <Input id="user-search" name="q" defaultValue={query} placeholder="Search by email" />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>

        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Account</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">2-step</th>
                <th className="py-2 pr-4 font-medium">Last sign-in</th>
                <th className="py-2 pr-4 font-medium">Created</th>
                <th className="py-2 pl-4 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((user) => {
                const member = staffByUserId.get(user.id);
                const staffRole = member && isStaffRole(member.role) ? member.role : null;
                const locked = isBanned(user);
                const mfa = (user.factors ?? []).some((factor) => factor.status === "verified");
                const allowed =
                  canAct && user.id !== session.user.id && (!staffRole || canManageStaffRole(session.role, staffRole));
                return (
                  <tr key={user.id}>
                    <td className="max-w-64 py-3 pr-4">
                      <p className="truncate font-medium">{user.email ?? user.phone ?? user.id}</p>
                      {staffRole && (
                        <Badge variant="outline" className="mt-1">
                          Staff · {STAFF_ROLE_LABELS[staffRole]}
                        </Badge>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      {locked ? (
                        <Badge variant="destructive">Locked</Badge>
                      ) : user.email_confirmed_at ? (
                        <Badge variant="secondary">Active</Badge>
                      ) : (
                        <Badge variant="outline">Unconfirmed</Badge>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-muted-foreground">{mfa ? "On" : "Off"}</td>
                    <td className="py-3 pr-4 whitespace-nowrap text-muted-foreground">{formatDate(user.last_sign_in_at)}</td>
                    <td className="py-3 pr-4 whitespace-nowrap text-muted-foreground">{formatDate(user.created_at)}</td>
                    <td className="py-3 pl-4">
                      <UserSecurityActions userId={user.id} email={user.email ?? user.id} locked={locked} canAct={allowed} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No accounts match.</p>}
        </div>

        {pageCount > 1 && (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              Page {Math.min(page, pageCount)} of {pageCount}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Button asChild size="sm" variant="outline">
                  <Link href={pageHref(page - 1)}>Previous</Link>
                </Button>
              )}
              {page < pageCount && (
                <Button asChild size="sm" variant="outline">
                  <Link href={pageHref(page + 1)}>Next</Link>
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
