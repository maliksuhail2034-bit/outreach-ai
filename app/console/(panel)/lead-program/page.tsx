import type { Json } from "@/types/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { countVerifiedLeadsByStatus, listPlanLeadQuotas, listRecentJobRuns } from "@/lib/db";
import { getPlan, type PlanId } from "@/lib/billing/plans";
import { requireStaffPage } from "@/lib/staff/auth";
import { hasStaffPermission } from "@/lib/staff/permissions";
import { listAuthUsers } from "@/lib/staff/directory";
import { buildCustomerRows, countCustomersByPlan, isPayingCustomer, loadCustomerInputs } from "@/lib/staff/customers";
import { periodFor } from "@/lib/verified-leads/period";
import { DatabaseIcon, SparklesIcon, TargetIcon, TriangleAlertIcon } from "lucide-react";

import { PlanQuotaEditor, RunAllocationButton } from "@/components/console/lead-program-controls";
import { PageHeader } from "@/components/console/page-header";
import { StatCard, StatGrid } from "@/components/console/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const PLAN_ORDER: PlanId[] = ["starter", "growth", "pro", "scale", "free"];
const dateFormatter = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });

function summaryNumber(summary: Json | null, key: string): number | null {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const value = summary[key];
  return typeof value === "number" ? value : null;
}

export default async function LeadProgramPage() {
  const session = await requireStaffPage("quotas:edit");
  const canRun = hasStaffPermission(session.role, "allocation:run");
  const admin = createAdminClient();
  const period = periodFor();

  const [quotas, users, poolCounts, runs] = await Promise.all([
    listPlanLeadQuotas(admin),
    listAuthUsers(admin),
    countVerifiedLeadsByStatus(admin),
    listRecentJobRuns(admin, "verified-leads", 10),
  ]);
  const customers = buildCustomerRows(await loadCustomerInputs(admin, period, users));
  const payingByPlan = countCustomersByPlan(customers);
  const quotaByPlan = new Map(quotas.map((row) => [row.plan_id, row.leads_per_month]));

  const monthlyNeed = PLAN_ORDER.reduce((total, planId) => total + (quotaByPlan.get(planId) ?? 0) * payingByPlan[planId], 0);
  const allocated = customers.filter((row) => row.verifiedLeads);
  const delivered = allocated.reduce((total, row) => total + (row.verifiedLeads?.delivered ?? 0), 0);
  const quotaTotal = allocated.reduce((total, row) => total + (row.verifiedLeads?.quota ?? 0), 0);
  const shortfalls = allocated
    .filter((row) => row.verifiedLeads && row.verifiedLeads.delivered < row.verifiedLeads.quota)
    .sort((a, b) => (b.verifiedLeads!.quota - b.verifiedLeads!.delivered) - (a.verifiedLeads!.quota - a.verifiedLeads!.delivered));
  const payingWithoutAllocation = customers.filter(
    (row) => isPayingCustomer(row) && !row.verifiedLeads && (quotaByPlan.get(row.planId) ?? 0) > 0,
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lead program"
        description="Verified leads each paying customer receives per calendar month (UTC), with no rollover. Allocation runs daily at 03:20 UTC and tops customers up after an upgrade. Only an owner can change quotas."
        actions={canRun ? <RunAllocationButton /> : undefined}
      />

      <StatGrid>
        <StatCard label={`Delivered in ${period}`} icon={SparklesIcon} value={`${delivered.toLocaleString()} / ${quotaTotal.toLocaleString()}`} />
        <StatCard label="Monthly need" icon={TargetIcon} value={monthlyNeed.toLocaleString()} hint="at current quotas" />
        <StatCard label="Active leads in pool" icon={DatabaseIcon} value={poolCounts.active.toLocaleString()} />
        <StatCard
          label="Customers short"
          icon={TriangleAlertIcon}
          value={shortfalls.length.toLocaleString()}
          tone={shortfalls.length > 0 ? "warning" : "default"}
          hint="this month"
        />
      </StatGrid>

      {poolCounts.active < monthlyNeed && (
        <p role="status" className="rounded-lg border border-warning/50 bg-warning/10 px-4 py-3 text-sm">
          <strong className="font-medium">Pool is smaller than one month&apos;s need.</strong> Each lead can go to up to 3
          customers, so this may still be enough — but if shortfalls appear, ask sales to upload more.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Quotas per plan</CardTitle>
          <CardDescription>
            Changes apply from the next allocation run. Lowering a quota never takes back leads already delivered this month.
          </CardDescription>
        </CardHeader>
        <CardContent className="relative overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className="py-2 pr-4 font-medium">Plan</th>
                <th scope="col" className="py-2 pr-4 text-right font-medium">Customers</th>
                <th scope="col" className="py-2 pr-4 font-medium">Leads per month</th>
                <th scope="col" className="py-2 text-right font-medium">Monthly need</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {PLAN_ORDER.map((planId) => {
                const quota = quotaByPlan.get(planId);
                const name = planId === "free" ? "No subscription" : getPlan(planId).name;
                return (
                  <tr key={planId}>
                    <td className="py-3 pr-4 font-medium">{name}</td>
                    <td className="py-3 pr-4 text-right tabular-nums">{payingByPlan[planId].toLocaleString()}</td>
                    <td className="py-3 pr-4">
                      {quota === undefined ? (
                        <span className="text-muted-foreground">Missing — apply the migration</span>
                      ) : (
                        <PlanQuotaEditor planId={planId} planName={name} leadsPerMonth={quota} />
                      )}
                    </td>
                    <td className="py-3 text-right tabular-nums">{((quota ?? 0) * payingByPlan[planId]).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Short this month</CardTitle>
          <CardDescription>
            Customers who received fewer than their quota in {period} because the pool ran out of leads eligible for them.
            {payingWithoutAllocation > 0 && ` ${payingWithoutAllocation} paying customer(s) haven't been allocated yet this month.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="relative overflow-x-auto">
          {shortfalls.length === 0 ? (
            <p className="text-sm text-muted-foreground">Everyone allocated this month got their full quota.</p>
          ) : (
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">Customer</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Plan</th>
                  <th scope="col" className="py-2 text-right font-medium">Delivered</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shortfalls.slice(0, 50).map((row) => (
                  <tr key={row.organizationId}>
                    <td className="max-w-72 py-2 pr-4">
                      <p className="truncate font-medium">{row.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{row.ownerEmail ?? "—"}</p>
                    </td>
                    <td className="py-2 pr-4">{row.planName}</td>
                    <td className="py-2 text-right tabular-nums">
                      {row.verifiedLeads!.delivered.toLocaleString()} / {row.verifiedLeads!.quota.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent scheduled runs</CardTitle>
          <CardDescription>The daily cron job. Manual runs appear in the Security center audit log.</CardDescription>
        </CardHeader>
        <CardContent className="relative overflow-x-auto">
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No scheduled runs recorded yet.</p>
          ) : (
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">Started</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Result</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Delivered</th>
                  <th scope="col" className="py-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">
                      {dateFormatter.format(new Date(run.started_at ?? run.created_at))} UTC
                    </td>
                    <td className="py-2 pr-4">
                      <Badge variant={run.status === "success" ? "secondary" : "destructive"}>
                        {run.status === "success" ? "OK" : "Problem"}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{summaryNumber(run.summary, "delivered")?.toLocaleString() ?? "—"}</td>
                    <td className="max-w-96 truncate py-2 text-muted-foreground">{run.error ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
