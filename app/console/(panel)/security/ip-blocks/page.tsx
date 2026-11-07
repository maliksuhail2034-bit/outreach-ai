import { createAdminClient } from "@/lib/supabase/admin";
import { listIpBlocks } from "@/lib/db";
import { requireStaffPage } from "@/lib/staff/auth";
import { hasStaffPermission } from "@/lib/staff/permissions";
import { listAuthUsers } from "@/lib/staff/directory";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IpBlockForm, UnblockIpButton } from "@/components/console/ip-block-form";

const dateFormatter = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

export default async function IpBlocksPage() {
  const session = await requireStaffPage("security:view");
  const admin = createAdminClient();
  const [blocks, users] = await Promise.all([listIpBlocks(admin), listAuthUsers(admin)]);
  const emailById = new Map(users.map((user) => [user.id, user.email ?? user.id]));
  const canAct = hasStaffPermission(session.role, "security:act");
  const now = new Date().getTime();

  return (
    <div className="space-y-6">
      {canAct && (
        <Card>
          <CardHeader>
            <CardTitle>Block an address</CardTitle>
            <CardDescription>
              Requests from blocked addresses get a 403 on every page and app API route within about a minute. For whole networks or ongoing attacks, use CrowdSec at the firewall instead.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <IpBlockForm />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Blocked addresses</CardTitle>
          <CardDescription>{blocks.length} entries.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Address / range</th>
                <th className="py-2 pr-4 font-medium">Reason</th>
                <th className="py-2 pr-4 font-medium">Expires</th>
                <th className="py-2 pr-4 font-medium">Added by</th>
                <th className="py-2 pl-4 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {blocks.map((block) => {
                const cidr = String(block.cidr);
                const expired = block.expires_at !== null && new Date(block.expires_at).getTime() <= now;
                return (
                  <tr key={block.id}>
                    <td className="py-2 pr-4 font-mono text-xs">{cidr}</td>
                    <td className="max-w-72 py-2 pr-4">{block.reason}</td>
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {block.expires_at ? (
                        <span className={expired ? "text-muted-foreground line-through" : undefined}>
                          {dateFormatter.format(new Date(block.expires_at))} UTC
                        </span>
                      ) : (
                        <Badge variant="outline">Permanent</Badge>
                      )}
                      {expired && <span className="ml-2 text-xs text-muted-foreground">(expired)</span>}
                    </td>
                    <td className="max-w-48 truncate py-2 pr-4 text-muted-foreground">
                      {block.created_by ? (emailById.get(block.created_by) ?? "Deleted account") : "—"}
                      <span className="block text-xs">{dateFormatter.format(new Date(block.created_at))} UTC</span>
                    </td>
                    <td className="py-2 pl-4 text-right">{canAct && <UnblockIpButton id={block.id} cidr={cidr} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {blocks.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No addresses are blocked.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
