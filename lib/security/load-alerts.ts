import type { Client } from "@/lib/db/shared";
import { listActiveIpBlocks, listUnhealthyJobRuns, verifyStaffAuditChain } from "@/lib/db";
import { buildSecurityAlerts } from "./alerts";
import { getAuthEventSummary } from "./auth-summary";
import { buildBlockList, isIpBlocked } from "./ip-blocklist";

const DAY_MS = 86_400_000;

// Loads the last 24 hours of inputs and builds the alert list — shared by the
// Security center's Alerts tab and the console overview, so both always show
// the same alerts. Sign-in counts are aggregated in SQL over the whole window.
// Service-role client only.
export async function loadSecurityAlerts(admin: Client, now: Date = new Date()) {
  const sinceIso = new Date(now.getTime() - DAY_MS).toISOString();
  const [summary, unhealthyJobs, blocks, auditChain] = await Promise.all([
    getAuthEventSummary(admin, sinceIso),
    listUnhealthyJobRuns(admin, sinceIso),
    listActiveIpBlocks(admin, now.toISOString()),
    verifyStaffAuditChain(admin),
  ]);

  const blockList = buildBlockList(blocks);
  const blockedIps = new Set(summary.by_ip.map((row) => row.ip).filter((ip) => isIpBlocked(blockList, ip)));
  const alerts = buildSecurityAlerts({ summary, unhealthyJobs, blockedIps, auditChain });

  return { alerts, summary, blocks, auditChain };
}
