import { createAdminClient } from "@/lib/supabase/admin";
import { listGrcControls } from "@/lib/db";
import { requireStaffPage } from "@/lib/staff/auth";
import { hasStaffPermission } from "@/lib/staff/permissions";
import { GRC_STATUS_LABELS, isGrcStatus } from "@/lib/security/grc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GrcControlEditor } from "@/components/console/grc-control-row";

const STATUS_VARIANT = { done: "secondary", in_progress: "outline", not_started: "destructive", not_applicable: "outline" } as const;

export default async function GrcPage() {
  const session = await requireStaffPage("security:view");
  const controls = await listGrcControls(createAdminClient());
  const canEdit = hasStaffPermission(session.role, "grc:edit");

  const frameworks = [...new Set(controls.map((control) => control.framework))];
  const applicable = controls.filter((control) => control.status !== "not_applicable");
  const done = applicable.filter((control) => control.status === "done").length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Governance, risk &amp; compliance</CardTitle>
          <CardDescription>
            {done} of {applicable.length} applicable controls done. Keep evidence (links, dates, who checked) in each control&apos;s notes.
          </CardDescription>
        </CardHeader>
      </Card>

      {frameworks.map((framework) => (
        <Card key={framework}>
          <CardHeader>
            <CardTitle className="text-base">{framework}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {controls
                .filter((control) => control.framework === framework)
                .map((control) => {
                  const status = isGrcStatus(control.status) ? control.status : "not_started";
                  return (
                    <li key={control.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium">{control.title}</p>
                          <p className="text-sm text-muted-foreground">{control.description}</p>
                        </div>
                        <Badge variant={STATUS_VARIANT[status]}>{GRC_STATUS_LABELS[status]}</Badge>
                      </div>
                      <GrcControlEditor id={control.id} status={status} notes={control.notes} canEdit={canEdit} />
                    </li>
                  );
                })}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
