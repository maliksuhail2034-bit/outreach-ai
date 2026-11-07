import { createAdminClient } from "@/lib/supabase/admin";
import { listAuthEvents } from "@/lib/db";
import { requireStaffPage } from "@/lib/staff/auth";
import { listAuthUsers } from "@/lib/staff/directory";
import { getAuthEventSummary } from "@/lib/security/auth-summary";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const WINDOW_DAYS = 7;
const RECENT_LIMIT = 100;
const dateFormatter = new Intl.DateTimeFormat("en-GB", { dateStyle: "short", timeStyle: "medium", timeZone: "UTC" });

const OUTCOME = {
  sign_in_success: { label: "Signed in", variant: "secondary" },
  sign_in_failure: { label: "Failed", variant: "destructive" },
  sign_in_rate_limited: { label: "Rate limited", variant: "outline" },
} as const;

function outcomeOf(type: string) {
  return OUTCOME[type as keyof typeof OUTCOME] ?? { label: type, variant: "outline" as const };
}

export default async function SignInsPage() {
  await requireStaffPage("security:view");
  const admin = createAdminClient();
  const sinceIso = new Date(new Date().getTime() - WINDOW_DAYS * 86_400_000).toISOString();
  // Countries and top addresses are aggregated in SQL over the whole window;
  // only the recent list reads rows, and only as many as it shows.
  const [summary, events, users] = await Promise.all([
    getAuthEventSummary(admin, sinceIso, 15),
    listAuthEvents(admin, { sinceIso, limit: RECENT_LIMIT }),
    listAuthUsers(admin),
  ]);
  const emailById = new Map(users.map((user) => [user.id, user.email ?? user.id]));
  const countries = summary.countries;
  const topIps = summary.by_ip;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Locations</CardTitle>
            <CardDescription>Sign-in outcomes by country (GeoIP of the client address), last {WINDOW_DAYS} days.</CardDescription>
          </CardHeader>
          <CardContent>
            {countries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sign-ins recorded yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Country</th>
                    <th className="py-2 pr-4 text-right font-medium">Signed in</th>
                    <th className="py-2 text-right font-medium">Failed / refused</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {countries.map((row) => (
                    <tr key={row.country}>
                      <td className="py-2 pr-4">{row.country}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{row.successes}</td>
                      <td className="py-2 text-right tabular-nums">{row.refused}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Addresses with failures</CardTitle>
            <CardDescription>Most failed or refused sign-ins per client IP, last {WINDOW_DAYS} days.</CardDescription>
          </CardHeader>
          <CardContent>
            {topIps.length === 0 ? (
              <p className="text-sm text-muted-foreground">No failed sign-ins.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">IP</th>
                    <th className="py-2 pr-4 font-medium">Country</th>
                    <th className="py-2 text-right font-medium">Failures</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {topIps.map((row) => (
                    <tr key={row.ip}>
                      <td className="py-2 pr-4 font-mono text-xs">{row.ip}</td>
                      <td className="py-2 pr-4">{row.country ?? "Unknown"}</td>
                      <td className="py-2 text-right tabular-nums">{row.refused}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent sign-in attempts</CardTitle>
          <CardDescription>
            The latest {RECENT_LIMIT}. Failed attempts are stored only as a hash of the address typed, never the address itself. Kept 90 days.
          </CardDescription>
        </CardHeader>
        <CardContent className="relative overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Time (UTC)</th>
                <th className="py-2 pr-4 font-medium">Outcome</th>
                <th className="py-2 pr-4 font-medium">Account</th>
                <th className="py-2 pr-4 font-medium">IP</th>
                <th className="py-2 pr-4 font-medium">Country</th>
                <th className="py-2 font-medium">Browser</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {events.slice(0, RECENT_LIMIT).map((event) => {
                const outcome = outcomeOf(event.event_type);
                return (
                  <tr key={event.id}>
                    <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground">{dateFormatter.format(new Date(event.created_at))}</td>
                    <td className="py-2 pr-4">
                      <Badge variant={outcome.variant}>{outcome.label}</Badge>
                    </td>
                    <td className="max-w-56 truncate py-2 pr-4">
                      {event.user_id ? (emailById.get(event.user_id) ?? "Deleted account") : event.email_hash ? (
                        <span className="font-mono text-xs text-muted-foreground">#{event.email_hash.slice(0, 10)}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">{event.ip ?? "—"}</td>
                    <td className="py-2 pr-4">{event.country ?? "—"}</td>
                    <td className="max-w-64 truncate py-2 text-xs text-muted-foreground" title={event.user_agent ?? undefined}>
                      {event.user_agent ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {events.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nothing recorded yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}
