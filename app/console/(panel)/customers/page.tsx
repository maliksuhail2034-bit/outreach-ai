import Link from "next/link";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaffPage } from "@/lib/staff/auth";
import { hasStaffPermission } from "@/lib/staff/permissions";
import { listAuthUsers } from "@/lib/staff/directory";
import { buildCustomerRows, isPayingCustomer, loadCustomerInputs, type CustomerRow } from "@/lib/staff/customers";
import { periodFor } from "@/lib/verified-leads/period";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/console/page-header";

const PAGE_SIZE = 50;
const FILTERS = [
  { value: "all", label: "All" },
  { value: "paying", label: "Paying" },
  { value: "unpaid", label: "No subscription" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

const dateFormatter = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Past due",
  pending: "Pending",
  suspended: "Suspended",
  cancelled: "Cancelled",
  expired: "Expired",
  completed: "Completed",
};

function subscriptionBadge(row: CustomerRow) {
  if (row.internal) return <Badge variant="outline">Internal</Badge>;
  const { normalizedStatus, grantsAccess, periodLapsed, cancelAtPeriodEnd } = row.subscription;
  if (!normalizedStatus) return <span className="text-muted-foreground">—</span>;
  const label = periodLapsed ? "Period lapsed" : `${STATUS_LABELS[normalizedStatus] ?? normalizedStatus}${cancelAtPeriodEnd ? " · cancels" : ""}`;
  return <Badge variant={grantsAccess ? "secondary" : "destructive"}>{label}</Badge>;
}

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string; page?: string }> }) {
  const session = await requireStaffPage("customers:view");
  const canSeeBilling = hasStaffPermission(session.role, "billing:view");
  const params = await searchParams;
  const query = (params.q ?? "").trim().toLowerCase().slice(0, 254);
  const filter: Filter = canSeeBilling ? (FILTERS.find((item) => item.value === params.filter)?.value ?? "all") : "all";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);

  const admin = createAdminClient();
  const period = periodFor();
  const users = await listAuthUsers(admin);
  const customers = buildCustomerRows(await loadCustomerInputs(admin, period, users));

  const matching = customers.filter((row) => {
    if (filter === "paying" && !isPayingCustomer(row)) return false;
    if (filter === "unpaid" && (row.internal || isPayingCustomer(row))) return false;
    if (!query) return true;
    return row.name.toLowerCase().includes(query) || (row.ownerEmail ?? "").toLowerCase().includes(query);
  });
  const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const rows = matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const payingCount = customers.filter(isPayingCustomer).length;

  function href(overrides: { filter?: Filter; page?: number }) {
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    const nextFilter = overrides.filter ?? filter;
    if (nextFilter !== "all") search.set("filter", nextFilter);
    const nextPage = overrides.page ?? 1;
    if (nextPage > 1) search.set("page", String(nextPage));
    const value = search.toString();
    return `/console/customers${value ? `?${value}` : ""}`;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Customers" description={<>{customers.length.toLocaleString()} workspaces
          {canSeeBilling && ` · ${payingCount.toLocaleString()} paying`}. To lock an account or end its sessions, use
          Security center → Users.</>} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        {canSeeBilling ? (
          <nav aria-label="Filter customers" className="flex flex-wrap gap-1.5">
            {FILTERS.map((item) => (
              <Link
                key={item.value}
                href={href({ filter: item.value })}
                aria-current={filter === item.value ? "page" : undefined}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm",
                  filter === item.value ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        ) : (
          <span />
        )}
        <form className="flex w-full gap-2 sm:w-auto" role="search" action="/console/customers">
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          <label htmlFor="customer-search" className="sr-only">
            Search by workspace or owner email
          </label>
          <Input id="customer-search" name="q" defaultValue={query} placeholder="Workspace or owner email" className="w-full sm:w-64" />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
      </div>

      <Card>
        <CardHeader className="sr-only">
          <CardTitle>Customer list</CardTitle>
          <CardDescription>Newest first.</CardDescription>
        </CardHeader>
        <CardContent className="relative overflow-x-auto pt-6">
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No customers match.</p>
          ) : (
            <table className={cn("w-full text-sm", canSeeBilling ? "min-w-[900px]" : "min-w-[560px]")}>
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">Workspace</th>
                  {canSeeBilling && <th scope="col" className="py-2 pr-4 font-medium">Plan</th>}
                  {canSeeBilling && <th scope="col" className="py-2 pr-4 font-medium">Subscription</th>}
                  {canSeeBilling && <th scope="col" className="py-2 pr-4 font-medium">Renews / ends</th>}
                  {canSeeBilling && <th scope="col" className="py-2 pr-4 text-right font-medium">Verified leads ({period})</th>}
                  <th scope="col" className="py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.organizationId}>
                    <td className="max-w-72 py-3 pr-4">
                      <p className="truncate font-medium">{row.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {row.ownerEmail ?? "Owner account missing"}
                        {row.ownerIsStaff && " · staff login"}
                      </p>
                    </td>
                    {canSeeBilling && <td className="py-3 pr-4">{row.planName}</td>}
                    {canSeeBilling && (
                      <td className="py-3 pr-4">
                        {subscriptionBadge(row)}
                        {row.subscription.provider && (
                          <p className="mt-1 text-xs text-muted-foreground capitalize">{row.subscription.provider}</p>
                        )}
                      </td>
                    )}
                    {canSeeBilling && (
                      <td className="py-3 pr-4 whitespace-nowrap text-muted-foreground">
                        {row.subscription.currentPeriodEnd ? dateFormatter.format(new Date(row.subscription.currentPeriodEnd)) : "—"}
                      </td>
                    )}
                    {canSeeBilling && (
                      <td className="py-3 pr-4 text-right tabular-nums">
                        {row.verifiedLeads ? `${row.verifiedLeads.delivered.toLocaleString()} / ${row.verifiedLeads.quota.toLocaleString()}` : "—"}
                      </td>
                    )}
                    <td className="py-3 whitespace-nowrap text-muted-foreground">{dateFormatter.format(new Date(row.createdAt))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {pageCount > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {Math.min(page, pageCount)} of {pageCount} · {matching.length.toLocaleString()} workspaces
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Button asChild size="sm" variant="outline">
                <Link href={href({ page: page - 1 })}>Previous</Link>
              </Button>
            )}
            {page < pageCount && (
              <Button asChild size="sm" variant="outline">
                <Link href={href({ page: page + 1 })}>Next</Link>
              </Button>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
