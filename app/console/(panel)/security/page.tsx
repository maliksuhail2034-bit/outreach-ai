import { AlertTriangleIcon, InfoIcon, ShieldAlertIcon, ShieldCheckIcon } from "lucide-react";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaffPage } from "@/lib/staff/auth";
import { hasStaffPermission } from "@/lib/staff/permissions";
import type { AlertSeverity } from "@/lib/security/alerts";
import { loadSecurityAlerts } from "@/lib/security/load-alerts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IpBlockForm } from "@/components/console/ip-block-form";

const SEVERITY = {
  critical: { label: "Critical", icon: ShieldAlertIcon, variant: "destructive" },
  warning: { label: "Warning", icon: AlertTriangleIcon, variant: "secondary" },
  info: { label: "Info", icon: InfoIcon, variant: "outline" },
} as const satisfies Record<AlertSeverity, { label: string; icon: unknown; variant: string }>;

export default async function SecurityAlertsPage() {
  const session = await requireStaffPage("security:view");
  const { alerts, authEvents, blocks, auditChain } = await loadSecurityAlerts(createAdminClient());
  const canAct = hasStaffPermission(session.role, "security:act");

  const successes = authEvents.filter((event) => event.event_type === "sign_in_success").length;
  const failures = authEvents.length - successes;
  const stats = [
    { label: "Sign-ins (24 h)", value: successes },
    { label: "Failed / refused (24 h)", value: failures },
    { label: "Blocked addresses", value: blocks.length },
    { label: "Audit entries verified", value: auditChain.checked },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="pb-2">
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{stat.value.toLocaleString()}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Alerts</CardTitle>
          <CardDescription>From the last 24 hours of sign-ins and background jobs, and a full check of the staff audit chain.</CardDescription>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldCheckIcon className="size-4" aria-hidden="true" />
              No alerts. Nothing unusual in the last 24 hours.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {alerts.map((alert) => {
                const severity = SEVERITY[alert.severity];
                const Icon = severity.icon;
                return (
                  <li key={alert.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={severity.variant} className="gap-1">
                        <Icon className="size-3" aria-hidden="true" />
                        {severity.label}
                      </Badge>
                      <p className="font-medium">{alert.title}</p>
                    </div>
                    <p className="text-sm text-muted-foreground">{alert.detail}</p>
                    {alert.ip && !alert.alreadyBlocked && canAct && <IpBlockForm defaultCidr={alert.ip} compact />}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
