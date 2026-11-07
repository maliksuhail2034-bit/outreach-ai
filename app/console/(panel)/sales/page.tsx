import Link from "next/link";

import { createAdminClient } from "@/lib/supabase/admin";
import { countVerifiedLeadsByStatus, listVerifiedLeads, type VerifiedLeadStatus } from "@/lib/db";
import { requireStaffPage } from "@/lib/staff/auth";
import { hasStaffPermission } from "@/lib/staff/permissions";
import { LeadPoolRowActions } from "@/components/console/lead-pool-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;
const MAX_SHARES = 3;
const STATUS_FILTERS: { value: VerifiedLeadStatus | "all"; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "retired", label: "Retired" },
  { value: "suppressed", label: "Opted out" },
  { value: "all", label: "All" },
];
const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export default async function LeadPoolPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; page?: string }> }) {
  const session = await requireStaffPage("leads:view");
  const canManage = hasStaffPermission(session.role, "leads:manage");
  const params = await searchParams;
  const status = (STATUS_FILTERS.find((filter) => filter.value === params.status)?.value ?? "active") as VerifiedLeadStatus | "all";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const search = (params.q ?? "").slice(0, 100);

  const admin = createAdminClient();
  const [counts, { rows, total }] = await Promise.all([
    countVerifiedLeadsByStatus(admin),
    listVerifiedLeads(admin, {
      status: status === "all" ? undefined : status,
      search: search || undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (overrides: Record<string, string>) => {
    const query = new URLSearchParams({ status, ...(search ? { q: search } : {}), ...overrides });
    return `/console/sales?${query.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lead pool</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Verified leads available for monthly delivery. Each goes to at most {MAX_SHARES} customers, never twice to the
            same one, with at least 30 days between deliveries.
          </p>
        </div>
        {canManage && (
          <Button asChild>
            <Link href="/console/sales/upload">Upload leads</Link>
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {(["active", "retired", "suppressed"] as const).map((key) => (
          <Card key={key}>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">{key === "suppressed" ? "Opted out" : key[0].toUpperCase() + key.slice(1)}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums">{counts[key].toLocaleString()}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Filter by status" className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((filter) => (
            <Link
              key={filter.value}
              href={href({ status: filter.value, page: "1" })}
              aria-current={status === filter.value ? "page" : undefined}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm",
                status === filter.value ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {filter.label}
            </Link>
          ))}
        </nav>
        <form className="flex gap-2" action="/console/sales">
          <input type="hidden" name="status" value={status} />
          <Input name="q" defaultValue={search} placeholder="Search email, company, surname" aria-label="Search the pool" className="w-64" />
          <Button type="submit" variant="outline">Search</Button>
        </form>
      </div>

      <Card>
        <CardContent className="-mx-4 overflow-x-auto px-4 pt-6 sm:mx-0 sm:px-6">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No leads match.</p>
          ) : (
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">Lead</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Company · Title</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Country</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Source</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Verified</th>
                  <th scope="col" className="py-2 pr-4 text-right font-medium">Delivered</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                  {canManage && <th scope="col" className="py-2 text-right font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((lead) => (
                  <tr key={lead.id}>
                    <td className="py-2 pr-4">
                      <p className="font-medium">{[lead.first_name, lead.last_name].filter(Boolean).join(" ") || "—"}</p>
                      <p className="text-xs text-muted-foreground">{lead.email}</p>
                    </td>
                    <td className="max-w-56 py-2 pr-4">
                      <p className="truncate">{lead.company ?? "—"}</p>
                      <p className="truncate text-xs text-muted-foreground">{lead.title ?? ""}</p>
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">{lead.country ?? "—"}</td>
                    <td className="max-w-40 truncate py-2 pr-4 text-muted-foreground">{lead.source}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{dateFormatter.format(new Date(lead.verified_at))}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {lead.times_delivered}/{MAX_SHARES}
                    </td>
                    <td className="py-2 pr-4">
                      <Badge variant={lead.status === "active" ? "default" : lead.status === "retired" ? "secondary" : "outline"}>
                        {lead.status === "suppressed" ? "opted out" : lead.status}
                      </Badge>
                    </td>
                    {canManage && (
                      <td className="py-2">
                        <LeadPoolRowActions id={lead.id} status={lead.status} email={lead.email} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} of {pages} · {total.toLocaleString()} leads
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Button asChild variant="outline" size="sm">
                <Link href={href({ page: String(page - 1) })}>Previous</Link>
              </Button>
            )}
            {page < pages && (
              <Button asChild variant="outline" size="sm">
                <Link href={href({ page: String(page + 1) })}>Next</Link>
              </Button>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
