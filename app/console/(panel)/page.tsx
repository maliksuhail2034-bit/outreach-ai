import Link from "next/link";
import {
  ArrowRightIcon,
  BuildingIcon,
  CreditCardIcon,
  DatabaseIcon,
  EyeIcon,
  GlobeIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";

import { createAdminClient } from "@/lib/supabase/admin";
import { countVerifiedLeadsByStatus } from "@/lib/db";
import { getPlan, PAID_PLAN_IDS } from "@/lib/billing/plans";
import { requireStaffPage } from "@/lib/staff/auth";
import { consoleNavFor } from "@/lib/staff/navigation";
import { hasStaffPermission, STAFF_ROLE_LABELS, type StaffPermission } from "@/lib/staff/permissions";
import { listAuthUsers } from "@/lib/staff/directory";
import { buildCustomerRows, countCustomersByPlan, isPayingCustomer, loadCustomerInputs } from "@/lib/staff/customers";
import { loadSecurityAlerts } from "@/lib/security/load-alerts";
import { countryName, getTrafficSummary, percentChange, trafficWindows } from "@/lib/traffic/summary";
import { periodFor } from "@/lib/verified-leads/period";
import { PageHeader, SectionHeading } from "@/components/console/page-header";
import { StatCard, StatGrid } from "@/components/console/stat-card";
import { Badge } from "@/components/ui/badge";

const DAY_MS = 86_400_000;

// Each section loads and renders only what the viewer's role may see.
export default async function ConsoleOverviewPage() {
  const session = await requireStaffPage("console:overview");
  const can = (permission: StaffPermission) => hasStaffPermission(session.role, permission);
  const admin = createAdminClient();
  const now = new Date();
  const period = periodFor(now);
  const week = trafficWindows(7, now);

  const [customers, security, pool, traffic] = await Promise.all([
    can("customers:view")
      ? listAuthUsers(admin).then(async (users) => buildCustomerRows(await loadCustomerInputs(admin, period, users), now))
      : null,
    can("security:view") ? loadSecurityAlerts(admin, now) : null,
    can("leads:view") ? countVerifiedLeadsByStatus(admin) : null,
    can("traffic:view")
      ? Promise.all([
          getTrafficSummary(admin, week.current.from, week.current.to, 3),
          getTrafficSummary(admin, week.previous.from, week.previous.to, 1),
        ])
      : null,
  ]);

  const links = consoleNavFor(session.role).filter((item) => item.href !== "/console");
  const critical = security?.alerts.filter((alert) => alert.severity === "critical").length ?? 0;
  const warnings = security?.alerts.filter((alert) => alert.severity === "warning").length ?? 0;
  const workspaces = customers?.filter((row) => !row.internal) ?? [];
  const allocated = customers?.filter((row) => row.verifiedLeads) ?? [];
  const delivered = allocated.reduce((total, row) => total + (row.verifiedLeads?.delivered ?? 0), 0);
  const owed = allocated.reduce((total, row) => total + (row.verifiedLeads?.quota ?? 0), 0);
  const short = allocated.filter((row) => row.verifiedLeads && row.verifiedLeads.delivered < row.verifiedLeads.quota).length;
  const byPlan = customers ? countCustomersByPlan(customers) : null;

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Welcome, ${session.staff.display_name}`}
        description={`Signed in as ${STAFF_ROLE_LABELS[session.role]}. Everything you change in the console is recorded in the staff audit log.`}
      />

      {security && (
        <Link
          href="/console/security"
          className={
            "flex flex-wrap items-center gap-3 rounded-xl border bg-card px-4 py-3 text-sm shadow-sm transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none " +
            (critical > 0 ? "border-destructive/50" : "border-border")
          }
        >
          {critical > 0 ? (
            <ShieldAlertIcon className="size-5 text-destructive" aria-hidden="true" />
          ) : (
            <ShieldCheckIcon className="size-5 text-success" aria-hidden="true" />
          )}
          {security.alerts.length === 0 ? (
            <span className="font-medium">No security alerts in the last 24 hours.</span>
          ) : (
            <>
              {critical > 0 && <Badge variant="destructive">{critical} critical</Badge>}
              {warnings > 0 && <Badge variant="secondary">{warnings} warning</Badge>}
              <span className="min-w-0 flex-1 truncate">
                {security.alerts[0].title}
                {security.alerts.length > 1 && ` and ${security.alerts.length - 1} more`}
              </span>
            </>
          )}
          <span className="ml-auto inline-flex items-center gap-1 text-muted-foreground">
            Security center
            <ArrowRightIcon className="size-4" aria-hidden="true" />
          </span>
        </Link>
      )}

      {traffic && (
        <section className="space-y-3">
          <SectionHeading title="Traffic · last 7 days" href="/console/traffic" linkLabel="Traffic" />
          <StatGrid columns={3}>
            <StatCard
              label="Visitors"
              icon={UsersIcon}
              value={traffic[0].visitors.toLocaleString()}
              change={percentChange(traffic[0].visitors, traffic[1].visitors)}
            />
            <StatCard
              label="Page loads"
              icon={EyeIcon}
              value={traffic[0].page_views.toLocaleString()}
              change={percentChange(traffic[0].page_views, traffic[1].page_views)}
            />
            <StatCard
              label="Countries"
              icon={GlobeIcon}
              value={traffic[0].countries_count.toLocaleString()}
              hint={
                traffic[0].countries.filter((row) => row.key !== "??").length > 0
                  ? traffic[0].countries
                      .filter((row) => row.key !== "??")
                      .map((row) => countryName(row.key))
                      .join(" · ")
                  : "No located visits yet"
              }
            />
          </StatGrid>
        </section>
      )}

      {customers && (
        <section className="space-y-3">
          <SectionHeading title="Customers" href="/console/customers" linkLabel="All customers" />
          <StatGrid>
            <StatCard label="Workspaces" icon={BuildingIcon} value={workspaces.length.toLocaleString()} />
            <StatCard
              label="New in 30 days"
              icon={UserPlusIcon}
              value={workspaces.filter((row) => now.getTime() - new Date(row.createdAt).getTime() < 30 * DAY_MS).length.toLocaleString()}
            />
            {can("billing:view") && byPlan && (
              <>
                <StatCard label="Paying" icon={CreditCardIcon} value={customers.filter(isPayingCustomer).length.toLocaleString()} />
                <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
                  <p className="text-xs font-medium text-muted-foreground sm:text-sm">Paying by plan</p>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    {PAID_PLAN_IDS.map((planId) => (
                      <div key={planId} className="flex items-baseline justify-between gap-2">
                        <dt className="truncate text-muted-foreground">{getPlan(planId).name}</dt>
                        <dd className="font-semibold tabular-nums">{byPlan[planId]}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </>
            )}
          </StatGrid>
        </section>
      )}

      {customers && can("allocation:run") && (
        <section className="space-y-3">
          <SectionHeading title={`Verified leads · ${period}`} href="/console/lead-program" linkLabel="Lead program" />
          <StatGrid columns={3}>
            <StatCard label="Delivered / owed" icon={SparklesIcon} value={`${delivered.toLocaleString()} / ${owed.toLocaleString()}`} />
            <StatCard label="Allocated" icon={BuildingIcon} value={allocated.length.toLocaleString()} />
            <StatCard
              label="Customers short"
              icon={ShieldAlertIcon}
              value={short.toLocaleString()}
              tone={short > 0 ? "warning" : "default"}
              hint={short > 0 ? "The pool ran out for them — upload more leads." : undefined}
            />
          </StatGrid>
        </section>
      )}

      {pool && (
        <section className="space-y-3">
          <SectionHeading title="Lead pool" href="/console/sales" linkLabel="Open pool" />
          <StatGrid columns={3}>
            <StatCard label="Active" icon={DatabaseIcon} value={pool.active.toLocaleString()} />
            <StatCard label="Retired" value={pool.retired.toLocaleString()} />
            <StatCard label="Opted out" value={pool.suppressed.toLocaleString()} />
          </StatGrid>
        </section>
      )}

      {links.length > 0 && (
        <section className="space-y-3">
          <SectionHeading title="Go to" />
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {links.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
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
