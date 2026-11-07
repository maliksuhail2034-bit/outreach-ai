import { createAdminClient } from "@/lib/supabase/admin";
import { listActiveIpBlocks } from "@/lib/db";
import { requireStaffPage } from "@/lib/staff/auth";
import { HEARTBEAT_ENV_VAR } from "@/lib/monitoring/heartbeat";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Status only, from what this app can actually observe. Wazuh and CrowdSec
// run outside the app; until they're wired in, they show as not connected.
export default async function SiemPage() {
  await requireStaffPage("security:view");
  const blocks = await listActiveIpBlocks(createAdminClient(), new Date().toISOString());
  const heartbeats = Object.values(HEARTBEAT_ENV_VAR);
  const heartbeatsSet = heartbeats.filter((name) => Boolean(process.env[name])).length;

  const rows = [
    {
      name: "Wazuh SIEM",
      connected: Boolean(process.env.WAZUH_DASHBOARD_URL),
      // Polimatiq runs on a single server (production and staging share the
      // Hostinger VPS), and a self-hosted Wazuh manager needs several GB of
      // RAM — so only a hosted manager with a lightweight agent here.
      detail:
        "Optional, as a hosted service: everything runs on one server, which has no room for a self-hosted Wazuh manager. Connect a hosted Wazuh (agent on the server) and set WAZUH_DASHBOARD_URL.",
    },
    {
      name: "CrowdSec",
      connected: Boolean(process.env.CROWDSEC_LAPI_URL),
      detail: "Recommended first: lightweight firewall-level blocking of scanners and brute-force sources on the server (fits alongside production). Set CROWDSEC_LAPI_URL once installed.",
    },
    { name: "App IP blocklist (proxy)", connected: true, detail: `${blocks.length} active entries enforced on every request.` },
    { name: "Sign-in rate limits", connected: true, detail: "Per IP and per account on sign-in, sign-up and password reset." },
    {
      name: "Error tracking webhook",
      connected: Boolean(process.env.ERROR_TRACKING_WEBHOOK_URL),
      detail: "Background-job and staff-console failures are sent to ERROR_TRACKING_WEBHOOK_URL.",
    },
    {
      name: "Cron heartbeats",
      connected: heartbeatsSet === heartbeats.length,
      detail: `${heartbeatsSet} of ${heartbeats.length} job heartbeat URLs configured.`,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>SIEM &amp; network</CardTitle>
        <CardDescription>What feeds security monitoring today, and what&apos;s still to connect.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.name} className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="font-medium">{row.name}</p>
                <p className="text-sm text-muted-foreground">{row.detail}</p>
              </div>
              <Badge variant={row.connected ? "secondary" : "outline"}>{row.connected ? "Connected" : "Not connected"}</Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
