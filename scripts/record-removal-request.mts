// Records one confirmed removal request (an email to the support address
// asking to stop campaign emails) as 'manual' suppressions — see
// docs/hostinger-cutover.md → Removal requests for the procedure.
//
// Run from a release directory, with the env file loaded by systemd (never
// sourced into a shell):
//   systemd-run --working-directory=/srv/polimatiq/current \
//     --property=EnvironmentFile=/etc/polimatiq/prod.env --wait --pipe --collect \
//     /usr/bin/node --no-warnings scripts/record-removal-request.mts \
//       --email person@example.com --request-ref "support 2026-10-26 <message-id>" \
//       [--sender-mailbox sales@customer.example]... [--owner <user-uuid>]...
//
// Without --apply it only reads and prints the plan and its digest. With
// --apply --plan-digest <digest> --audit-log <file> it appends a "pending"
// line to the audit log, writes, re-reads the suppressions, and appends
// "done" (or "failed"). A plan whose digest no longer matches is refused.
// Prints no secret; the service-role key comes from the environment only.
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

const { planRemovalRequest, applyRemovalPlan }: typeof import("@/lib/email/removal-request") = await import(
  pathToFileURL(resolve(process.cwd(), "lib/email/removal-request.ts")).href
);

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    "request-ref": { type: "string" },
    "sender-mailbox": { type: "string", multiple: true },
    owner: { type: "string", multiple: true },
    apply: { type: "boolean", default: false },
    "plan-digest": { type: "string" },
    "audit-log": { type: "string" },
  },
  strict: true,
});

// Exit codes: 0 done or planned, 1 refused or failed, 2 no account matched.
// Sets process.exitCode rather than calling process.exit(), which can abort
// while the HTTP client still has sockets closing.
process.exitCode = await main();

async function main(): Promise<number> {
  const projectUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!projectUrl || !serviceKey) {
    return refuse("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (load the env file with systemd).");
  }
  if (values.apply && (!values["plan-digest"] || !values["audit-log"])) {
    return refuse("--apply needs --plan-digest (from a dry run) and --audit-log.");
  }

  const supabase = createClient<Database>(projectUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let plan;
  try {
    plan = await planRemovalRequest(supabase, projectUrl, {
      email: values.email ?? "",
      requestRef: values["request-ref"] ?? "",
      senderMailboxes: values["sender-mailbox"] ?? [],
      ownerIds: values.owner ?? [],
    });
  } catch (error) {
    return refuse(`Refused: ${error instanceof Error ? error.message : String(error)}`);
  }

  console.log(`project      ${plan.projectUrl}`);
  console.log(`address      ${plan.email}`);
  console.log(`request      ${plan.requestRef}`);
  if (plan.targets.length === 0) {
    console.log("accounts     none: no lead has this address and no --sender-mailbox matched");
  }
  for (const target of plan.targets) {
    console.log(`account      ${target.userId}`);
    console.log(`  leads with this address  ${target.leadIds.length}`);
    if (target.senderMailboxes.length > 0) console.log(`  owns sender mailbox      ${target.senderMailboxes.join(", ")}`);
    console.log(`  suppression              ${target.existingSuppression ? `already (${target.existingSuppression})` : "will be created (manual)"}`);
    console.log(`  open enrollments to stop ${target.openEnrollmentIds.length}`);
  }
  for (const userId of plan.excludedCandidates) console.log(`not selected ${userId} (also matches; left out by --owner)`);
  console.log(`plan digest  ${plan.digest}`);

  if (!values.apply) {
    console.log("dry run: nothing written");
    return plan.targets.length === 0 ? 2 : 0;
  }

  if (values["plan-digest"] !== plan.digest) {
    return refuse("Refused: the plan changed since the dry run (digest mismatch). Nothing written; dry-run again.");
  }

  const auditLog = values["audit-log"] as string;
  const audit = (entry: Record<string, unknown>) =>
    appendFileSync(auditLog, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`, { mode: 0o600 });
  const base = { requestRef: plan.requestRef, email: plan.email, project: plan.projectUrl, digest: plan.digest };

  if (plan.targets.length === 0) {
    audit({ ...base, status: "unmatched", note: "no account identified; nothing written" });
    console.log("unmatched: recorded in the audit log, nothing written. Ask for the forwarded email and use --sender-mailbox.");
    return 2;
  }

  audit({ ...base, status: "pending", accounts: plan.targets.map((target) => target.userId) });
  try {
    const results = await applyRemovalPlan(supabase, plan);
    audit({ ...base, status: "done", results });
    for (const result of results) {
      console.log(`done         ${result.userId}: suppression ${result.suppression} (${result.reason}), ${result.stoppedEnrollments} enrollment(s) stopped`);
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    audit({ ...base, status: "failed", error: message });
    return refuse(`FAILED: ${message}. Re-run the dry run; applying again is safe.`);
  }
}

function refuse(message: string): number {
  console.error(message);
  return 1;
}
