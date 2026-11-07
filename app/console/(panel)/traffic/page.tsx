import Link from "next/link";
import { EyeIcon, GlobeIcon, LogInIcon, UsersIcon } from "lucide-react";

import { createAdminClient } from "@/lib/supabase/admin";
import { usesLocalGeoip } from "@/lib/billing/geoip";
import { requireStaffPage } from "@/lib/staff/auth";
import {
  countryName,
  getTrafficSummary,
  parseTrafficRange,
  percentChange,
  TRAFFIC_RANGES,
  trafficWindows,
} from "@/lib/traffic/summary";
import { DailyBarChart } from "@/components/analytics/daily-bar-chart";
import { GeoipAttribution } from "@/components/billing/geoip-attribution";
import { BarList } from "@/components/console/bar-list";
import { PageHeader } from "@/components/console/page-header";
import { StatCard, StatGrid } from "@/components/console/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const DEVICE_LABELS: Record<string, string> = { desktop: "Desktop", mobile: "Mobile", tablet: "Tablet" };

export default async function TrafficPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  await requireStaffPage("traffic:view");
  const days = parseTrafficRange((await searchParams).range);
  const windows = trafficWindows(days);
  const admin = createAdminClient();
  const [summary, previous] = await Promise.all([
    getTrafficSummary(admin, windows.current.from, windows.current.to, 10),
    getTrafficSummary(admin, windows.previous.from, windows.previous.to, 1),
  ]);
  const geoipMissing = process.env.VERCEL !== "1" && !usesLocalGeoip();
  const signedInShare = summary.page_views > 0 ? Math.round((summary.signed_in_views / summary.page_views) * 100) : 0;
  const located = summary.countries.filter((row) => row.key !== "??");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Traffic"
        description="Who visits Polimatiq and from where. Counted on our own server without cookies: no IP addresses or browser details are stored, and visitors can't be followed from one day to the next."
        actions={
          <nav aria-label="Date range" className="inline-flex rounded-lg border border-border bg-card p-0.5">
            {TRAFFIC_RANGES.map((range) => (
              <Link
                key={range.days}
                href={`/console/traffic?range=${range.days}`}
                aria-current={range.days === days ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  range.days === days ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {range.label}
              </Link>
            ))}
          </nav>
        }
      />

      {geoipMissing && (
        <p role="status" className="rounded-lg border border-warning/50 bg-warning/10 px-4 py-3 text-sm">
          The country database isn&apos;t configured on this server (GEOIP_COUNTRY_DB_PATH), so every visit shows as
          &ldquo;Unknown&rdquo; country.
        </p>
      )}

      <StatGrid>
        <StatCard
          label="Visitors"
          icon={UsersIcon}
          value={summary.visitors.toLocaleString()}
          change={percentChange(summary.visitors, previous.visitors)}
        />
        <StatCard
          label="Page loads"
          icon={EyeIcon}
          value={summary.page_views.toLocaleString()}
          change={percentChange(summary.page_views, previous.page_views)}
        />
        <StatCard
          label="Countries"
          icon={GlobeIcon}
          value={summary.countries_count.toLocaleString()}
          hint={located[0] ? `Top: ${countryName(located[0].key)}` : undefined}
        />
        <StatCard label="Signed-in share" icon={LogInIcon} value={`${signedInShare}%`} hint="of page loads by signed-in users" />
      </StatGrid>

      <DailyBarChart
        title="Visitors per day"
        description={`Unique visitors each day, last ${days} days (UTC).`}
        data={summary.daily.map((point) => ({ date: point.date, value: point.visitors }))}
        barClassName="bg-primary"
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Countries</CardTitle>
            <CardDescription>Where visitors are, from their network address at the time of the visit.</CardDescription>
          </CardHeader>
          <CardContent>
            <BarList
              labelHeader="Country"
              valueLabel="Visitors"
              secondaryLabel="Loads"
              rows={summary.countries.map((row) => ({
                key: row.key,
                label: (
                  <>
                    <span aria-hidden="true" className="mr-2 inline-flex w-7 justify-center rounded bg-background/70 px-1 font-mono text-[10px] font-semibold text-muted-foreground">{row.key === "??" ? "—" : row.key}</span>
                    {countryName(row.key)}
                  </>
                ),
                value: row.visitors,
                secondary: row.views,
              }))}
              empty="No visits recorded in this period yet."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sources</CardTitle>
            <CardDescription>The site that sent visitors here, or the utm_source of a campaign link.</CardDescription>
          </CardHeader>
          <CardContent>
            <BarList
              labelHeader="Source"
              valueLabel="Visitors"
              secondaryLabel="Loads"
              rows={summary.referrers.map((row) => ({
                key: row.key,
                label: row.key === "(direct)" ? "Direct / unknown" : row.key,
                value: row.visitors,
                secondary: row.views,
              }))}
              empty="No visits recorded in this period yet."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top pages</CardTitle>
            <CardDescription>Pages people opened directly or landed on. Ids and tokens in links are hidden as :id.</CardDescription>
          </CardHeader>
          <CardContent>
            <BarList
              labelHeader="Page"
              valueLabel="Loads"
              secondaryLabel="Visitors"
              rows={summary.pages.map((row) => ({
                key: row.key,
                label: <span className="font-mono text-xs">{row.key}</span>,
                value: row.views,
                secondary: row.visitors,
              }))}
              empty="No visits recorded in this period yet."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Devices</CardTitle>
            <CardDescription>From the browser type at the time of the visit; the browser string itself isn&apos;t kept.</CardDescription>
          </CardHeader>
          <CardContent>
            <BarList
              labelHeader="Device"
              valueLabel="Visitors"
              secondaryLabel="Loads"
              rows={summary.devices.map((row) => ({
                key: row.key,
                label: DEVICE_LABELS[row.key] ?? row.key,
                value: row.visitors,
                secondary: row.views,
              }))}
              empty="No visits recorded in this period yet."
            />
          </CardContent>
        </Card>
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          A page load is a full visit to a page (opening a link, refreshing). Clicking between pages inside the app after
          that isn&apos;t counted again. Search-engine crawlers and other bots are left out. Staff console pages are never
          counted. Data is kept for 180 days.
        </p>
        <GeoipAttribution />
      </div>
    </div>
  );
}
