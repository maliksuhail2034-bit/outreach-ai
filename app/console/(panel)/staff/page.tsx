import { createAdminClient } from "@/lib/supabase/admin";
import { getStaffWorkSeconds, listStaffMembers, listUsersWithVerifiedMfa, type StaffRole } from "@/lib/db";
import { requireStaffPage } from "@/lib/staff/auth";
import { listAuthUsers } from "@/lib/staff/directory";
import { isStaffRole, manageableRoles } from "@/lib/staff/permissions";
import { formatDuration } from "@/lib/staff/work";
import { StaffManager, type StaffRow } from "@/components/console/staff-manager";
import { PageHeader } from "@/components/console/page-header";

const WEEK_MS = 7 * 86_400_000;

export default async function EmployeesPage() {
  const session = await requireStaffPage("staff:view");
  const admin = createAdminClient();
  const [members, users, hours] = await Promise.all([
    listStaffMembers(admin),
    listAuthUsers(admin),
    getStaffWorkSeconds(admin, new Date(new Date().getTime() - WEEK_MS).toISOString()),
  ]);
  const userById = new Map(users.map((user) => [user.id, user]));
  const withMfa = await listUsersWithVerifiedMfa(admin, members.map((member) => member.user_id));

  const rows: StaffRow[] = members
    .filter((member) => isStaffRole(member.role))
    .map((member) => {
      const user = userById.get(member.user_id);
      return {
        id: member.id,
        displayName: member.display_name,
        username: member.username,
        email: user?.email ?? "",
        role: member.role as StaffRole,
        status: member.status as StaffRow["status"],
        mfa: withMfa.has(member.user_id),
        lastSeenAt: member.last_seen_at,
        weekHours: formatDuration(hours.get(member.id)?.seconds ?? 0),
        isSelf: member.user_id === session.user.id,
      };
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employees"
        description="Owners can manage every role. Security can manage security and sales accounts, never owners. Every change is recorded in the staff audit log."
      />
      <StaffManager rows={rows} manageableRoles={[...manageableRoles(session.role)]} />
    </div>
  );
}
