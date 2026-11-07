import Link from "next/link";
import { ArrowRightIcon, ShieldAlertIcon, ShieldCheckIcon } from "lucide-react";

import { createAdminClient } from "@/lib/supabase/admin";
import { countVerifiedLeadsByStatus } from "@/lib/db";
import { getPlan, PAID_PLAN_IDS } from "@/lib/billing/plans";
import { requireStaffPage } from "@/lib/staff/auth";
import { consoleNavFor } from "@/lib/staff/navigation";
import { hasStaffPermission, STAFF_ROLE_LABELS } from "@/lib/staff/permissions";
import { listAuthUsers } from "@/lib/staff/directory";
import { buildCustomerRows, countCustomersByPlan, isPayingCustomer, loadCustomerInputs } from "@/lib/staff/customers";
import { loadSecurityAlerts } from "@/lib/security/load-alerts";
import { periodFor } from "@/lib/verified-leads/period";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const DAY_MS = 86_400_000;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint && <CardContent className="pt-0 text-xs text-muted-foreground">{hint}</CardContent>}
    </Card>
  );
}

function SectionHeading({ title, href, linkLabel }: { title: string; href: string; linkLabel: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <Link href={href} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        {linkLabel}
        <ArrowRightIcon className="size-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

// Each section loads and renders only what the viewer's role may see.
export default async function ConsoleOverviewPage() {
  const session = await requireStaffPage("console:overview");
  const can = (permission: Parameters<typeof hasStaffPermission>[1]) => hasStaffPermission(session.role, permission);
  const admin = createAdminClient();
  const now = new Date();
  const period = periodFor(now);

  const [customers, security, pool] = await Promise.all([
    can("customers:view")
      ? listAuthUsers(admin).then(async (users) => buildCustomerRows(await loadCustomerInputs(admin, period, users), now))
      : null,
    can("security:view") ? loadSecurityAlerts(admin, now) : null,
    can("leads:view") ? countVerifiedLeadsByStatus(admin) : null,
  ]);

  const links = consoleNavFor(session.role).filter((item) => item.href !== "/console");

  return (
    <div className="max-w-6xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, {session.staff.display_name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Signed in as {STAFF_ROLE_LABELS[session.role]}. Everything you change in the console is recorded in the staff audit log.
        </p>
      </div>

      {security && (
        <section className="space-y-3">
          <SectionHeading title="Security" href="/console/security" linkLabel="Security center" />
          {(() => {
            const critical = security.alerts.filter((alert) => alert.severity === "critical").length;
            const warning = security.alerts.filter((alert) => alert.severity === "warning").length;
            const Icon = critical > 0 ? ShieldAlertIcon : ShieldCheckIcon;
            return (
              <Card>
                <CardContent className="flex flex-wrap items-center gap-3 pt-6 text-sm">
                  <Icon className="size-5" aria-hidden="true" />
                  {security.alerts.length === 0 ? (
                    <span>No alerts in the last 24 hours.</span>
                  ) : (
                    <>
                      {critical > 0 && <Badge variant="destructive">{critical} critical</Badge>}
                      {warning > 0 && <Badge variant="secondary">{warning} warning</Badge>}
                      <span>
                        {security.alerts[0].title}
                        {security.alerts.length > 1 && ` and ${security.alerts.length - 1} more`}
                      </span>
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })()}
        </section>
      )}

      {customers && (
        <section className="space-y-3">
          <SectionHeading title="Customers" href="/console/customers" linkLabel="All customers" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Workspaces" value={customers.filter((row) => !row.internal).length.toLocaleString()} />
            <Stat
              label="New in the last 30 days"
              value={customers
                .filter((row) => !row.internal && now.getTime() - new Date(row.createdAt).getTime() < 30 * DAY_MS)
                .length.toLocaleString()}
            />
            {can("billing:view") && (
              <>
                <Stat label="Paying" value={customers.filter(isPayingCustomer).length.toLocaleString()} />
                <Stat
                  label="By plan"
                  value={(() => {
                    const byPlan = countCustomersByPlan(customers);
                    return PAID_PLAN_IDS.map((planId) => byPlan[planId]).join(" · ");
                  })()}
                  hint={PAID_PLAN_IDS.map((planId) => getPlan(planId).name).join(" · ")}
                />
              </>
            )}
          </div>
        </section>
      )}

      {customers && can("allocation:run") && (
        <section className="space-y-3">
          <SectionHeading title={`Verified leads · ${period}`} href="/console/lead-program" linkLabel="Lead program" />
          {(() => {
            const allocated = customers.filter((row) => row.verifiedLeads);
            const delivered = allocated.reduce((total, row) => total + (row.verifiedLeads?.delivered ?? 0), 0);
            const quota = allocated.reduce((total, row) => total + (row.verifiedLeads?.quota ?? 0), 0);
            const short = allocated.filter((row) => row.verifiedLeads && row.verifiedLeads.delivered < row.verifiedLeads.quota).length;
            return (
              <div className="grid gap-4 sm:grid-cols-3">
                <Stat label="Delivered / owed" value={`${delivered.toLocaleString()} / ${quota.toLocaleString()}`} />
                <Stat label="Customers allocated" value={allocated.length.toLocaleString()} />
                <Stat label="Customers short" value={short.toLocaleString()} hint={short > 0 ? "The pool ran out for them — upload more leads." : undefined} />
              </div>
            );
          })()}
        </section>
      )}

      {pool && (
        <section className="space-y-3">
          <SectionHeading title="Lead pool" href="/console/sales" linkLabel="Open pool" />
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Active" value={pool.active.toLocaleString()} />
            <Stat label="Retired" value={pool.retired.toLocaleString()} />
            <Stat label="Opted out" value={pool.suppressed.toLocaleString()} />
          </div>
        </section>
      )}

      {links.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Go to</h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {links.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="flex items-center justify-between rounded-md border border-border px-4 py-3 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  {item.title}
                  <ArrowRightIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
