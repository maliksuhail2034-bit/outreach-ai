import type { Client } from "@/lib/db/shared";
import { listActiveIpBlocks, listAuthEvents, listStaffMembers, listUnhealthyJobRuns, verifyStaffAuditChain } from "@/lib/db";
import { buildSecurityAlerts } from "./alerts";
import { buildBlockList, isIpBlocked } from "./ip-blocklist";

const DAY_MS = 86_400_000;

// Loads the last 24 hours of inputs and builds the alert list — shared by the
// Security center's Alerts tab and the console overview, so both always show
// the same alerts. Service-role client only.
export async function loadSecurityAlerts(admin: Client, now: Date = new Date()) {
  const sinceIso = new Date(now.getTime() - DAY_MS).toISOString();
  const [authEvents, unhealthyJobs, blocks, staff, auditChain] = await Promise.all([
    listAuthEvents(admin, { sinceIso, limit: 5000 }),
    listUnhealthyJobRuns(admin, sinceIso),
    listActiveIpBlocks(admin, now.toISOString()),
    listStaffMembers(admin),
    verifyStaffAuditChain(admin),
  ]);

  const blockList = buildBlockList(blocks);
  const seenIps = new Set(authEvents.flatMap((event) => (event.ip ? [event.ip] : [])));
  const blockedIps = new Set([...seenIps].filter((ip) => isIpBlocked(blockList, ip)));
  const alerts = buildSecurityAlerts({
    authEvents,
    unhealthyJobs,
    blockedIps,
    staffUserIds: new Set(staff.map((member) => member.user_id)),
    auditChain,
  });

  return { alerts, authEvents, blocks, auditChain };
}
