import { createAdminClient } from "@/lib/supabase/admin";
import { listStaffMembers, type StaffRole } from "@/lib/db";
import { requireStaffPage } from "@/lib/staff/auth";
import { listAuthUsers } from "@/lib/staff/directory";
import { manageableRoles } from "@/lib/staff/permissions";
import { isStaffRole } from "@/lib/staff/permissions";
import { StaffManager, type StaffRow } from "@/components/console/staff-manager";

export default async function StaffPage() {
  const session = await requireStaffPage("staff:view");
  const admin = createAdminClient();
  const [members, users] = await Promise.all([listStaffMembers(admin), listAuthUsers(admin)]);
  const emailById = new Map(users.map((user) => [user.id, user.email ?? ""]));

  const rows: StaffRow[] = members
    .filter((member) => isStaffRole(member.role))
    .map((member) => ({
      id: member.id,
      displayName: member.display_name,
      email: emailById.get(member.user_id) ?? "",
      role: member.role as StaffRole,
      status: member.status as StaffRow["status"],
      lastSeenAt: member.last_seen_at,
      isSelf: member.user_id === session.user.id,
    }));

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Staff accounts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Owners can manage every role. Security can manage security and sales accounts. All staff must use 2-step login.
        </p>
      </div>
      <StaffManager rows={rows} manageableRoles={[...manageableRoles(session.role)]} />
    </div>
  );
}
