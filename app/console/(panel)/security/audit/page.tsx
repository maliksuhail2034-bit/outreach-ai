import { ShieldAlertIcon, ShieldCheckIcon } from "lucide-react";

import { createAdminClient } from "@/lib/supabase/admin";
import { listStaffAuditLog, verifyStaffAuditChain } from "@/lib/db";
import { requireStaffPage } from "@/lib/staff/auth";
import { listAuthUsers } from "@/lib/staff/directory";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const LIMIT = 200;
const dateFormatter = new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "medium", timeZone: "UTC" });

export default async function AuditLogPage() {
  await requireStaffPage("audit:view");
  const admin = createAdminClient();
  const [entries, chain, users] = await Promise.all([listStaffAuditLog(admin, { limit: LIMIT }), verifyStaffAuditChain(admin), listAuthUsers(admin)]);
  const emailById = new Map(users.map((user) => [user.id, user.email ?? user.id]));
  const intact = chain.firstBrokenSeq === null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Staff audit log</CardTitle>
        <CardDescription>
          Every staff action, newest first (latest {LIMIT}). Append-only: the database refuses edits and deletes, and each entry&apos;s hash covers the one before it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className={`flex items-center gap-2 text-sm ${intact ? "text-muted-foreground" : "font-medium text-destructive"}`} role="status">
          {intact ? <ShieldCheckIcon className="size-4" aria-hidden="true" /> : <ShieldAlertIcon className="size-4" aria-hidden="true" />}
          {intact
            ? `Hash chain verified: all ${chain.checked.toLocaleString()} entries intact.`
            : `Hash chain broken at entry #${chain.firstBrokenSeq}. The log was changed outside the app — investigate immediately.`}
        </p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">#</th>
                <th className="py-2 pr-4 font-medium">Time (UTC)</th>
                <th className="py-2 pr-4 font-medium">Staff</th>
                <th className="py-2 pr-4 font-medium">Action</th>
                <th className="py-2 pr-4 font-medium">Target</th>
                <th className="py-2 pr-4 font-medium">IP</th>
                <th className="py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((entry) => (
                <tr key={entry.id} className="align-top">
                  <td className="py-2 pr-4 text-muted-foreground tabular-nums">{entry.seq}</td>
                  <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">{dateFormatter.format(new Date(entry.created_at))}</td>
                  <td className="max-w-48 py-2 pr-4">
                    <p className="truncate">{entry.actor_user_id ? (emailById.get(entry.actor_user_id) ?? "Deleted account") : "System"}</p>
                    {entry.actor_role && <p className="text-xs text-muted-foreground capitalize">{entry.actor_role}</p>}
                  </td>
                  <td className="py-2 pr-4">
                    <Badge variant="outline" className="font-mono">
                      {entry.action}
                    </Badge>
                  </td>
                  <td className="max-w-40 truncate py-2 pr-4 text-xs text-muted-foreground">
                    {entry.target_type ? `${entry.target_type} ${entry.target_id ?? ""}` : "—"}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">{entry.ip ?? "—"}</td>
                  <td className="max-w-72 py-2">
                    <code className="block truncate text-xs text-muted-foreground" title={JSON.stringify(entry.metadata)}>
                      {JSON.stringify(entry.metadata)}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No staff actions recorded yet.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
