import { createHash } from "crypto";
import type { Client } from "@/lib/db/shared";

// Removal requests that arrive by email — chiefly recipients of links signed
// with the lost pre-cutover UNSUBSCRIBE_TOKEN_SECRET, whom the "Link no
// longer valid" page sends to the support address. Turns one confirmed
// request into a 'manual' suppression for every account that should honour
// it, and stops those accounts' open enrollments for the address.
//
// Operator tooling with no user in the loop (CLAUDE.md's admin.ts carve-out),
// run through scripts/record-removal-request.mts. Only type imports, so the
// script can load this file under plain Node on the server.
//
// Who must honour a request: every account that holds the address as a lead,
// plus the account owning the mailbox the email came from (that identifies
// the sender even if the lead was deleted, so a later re-import is blocked
// too). An explicit owner list replaces that default.

const OPEN_ENROLLMENT_STATUSES = ["pending", "active"];
const MAX_MAILBOX_ROWS = 10_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface RemovalRequestInput {
  email: string;
  requestRef: string;
  senderMailboxes: string[];
  ownerIds: string[];
}

export interface RemovalTarget {
  userId: string;
  leadIds: string[];
  senderMailboxes: string[];
  existingSuppression: string | null;
  openEnrollmentIds: string[];
}

export interface RemovalPlan {
  projectUrl: string;
  email: string;
  requestRef: string;
  targets: RemovalTarget[];
  // Accounts that matched but were left out by an explicit owner list.
  excludedCandidates: string[];
  digest: string;
}

export interface RemovalTargetResult {
  userId: string;
  suppression: "created" | "already_suppressed";
  reason: string;
  stoppedEnrollments: number;
}

// Lead addresses are stored trimmed and lowercased (leads/actions.ts,
// import-actions.ts), and the suppression check compares exactly, so the
// request's address must be normalised the same way.
export function normalizeRemovalEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function parseRemovalRequestInput(input: RemovalRequestInput): RemovalRequestInput {
  const email = normalizeRemovalEmail(input.email);
  if (!email) throw new Error("--email is not a valid email address.");
  const requestRef = input.requestRef.trim();
  if (!requestRef) throw new Error("--request-ref is required: the support message this removal answers.");
  const senderMailboxes = input.senderMailboxes.map((value) => {
    const mailbox = normalizeRemovalEmail(value);
    if (!mailbox) throw new Error(`--sender-mailbox ${JSON.stringify(value)} is not a valid email address.`);
    return mailbox;
  });
  const ownerIds = input.ownerIds.map((value) => {
    const id = value.trim().toLowerCase();
    if (!UUID_PATTERN.test(id)) throw new Error(`--owner ${JSON.stringify(value)} is not a user id (uuid).`);
    return id;
  });
  return { email, requestRef, senderMailboxes: unique(senderMailboxes), ownerIds: unique(ownerIds) };
}

// Covers everything apply() acts on, so a plan reviewed in a dry run can only
// be applied while the database still looks the way it did then.
export function removalPlanDigest(plan: Omit<RemovalPlan, "digest">): string {
  const canonical = JSON.stringify({
    projectUrl: plan.projectUrl,
    email: plan.email,
    requestRef: plan.requestRef,
    targets: [...plan.targets]
      .sort((a, b) => a.userId.localeCompare(b.userId))
      .map((target) => [target.userId, target.existingSuppression, [...target.openEnrollmentIds].sort()]),
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export async function planRemovalRequest(
  supabase: Client,
  projectUrl: string,
  rawInput: RemovalRequestInput,
): Promise<RemovalPlan> {
  const input = parseRemovalRequestInput(rawInput);

  const { data: ownLeads, error: leadsError } = await supabase.from("leads").select("id, user_id").eq("email", input.email);
  if (leadsError) throw leadsError;

  // Customer copies of a Polimatiq verified-pool lead store a placeholder
  // address; they're found through the pool row holding the real one.
  const { data: poolRows, error: poolError } = await supabase.from("verified_leads").select("id").eq("email", input.email);
  if (poolError) throw poolError;
  let poolLeads: { id: string; user_id: string }[] = [];
  if (poolRows.length > 0) {
    const { data, error } = await supabase
      .from("leads")
      .select("id, user_id")
      .in("verified_lead_id", poolRows.map((row) => row.id));
    if (error) throw error;
    poolLeads = data;
  }
  const leads = [...ownLeads, ...poolLeads];

  const mailboxOwners = new Map<string, string[]>();
  if (input.senderMailboxes.length > 0) {
    // Mailbox addresses aren't normalised on insert, so they're compared
    // case-insensitively here rather than with an exact filter.
    const { data: mailboxes, error } = await supabase
      .from("mailboxes")
      .select("user_id, email")
      .range(0, MAX_MAILBOX_ROWS - 1);
    if (error) throw error;
    if (mailboxes.length >= MAX_MAILBOX_ROWS) throw new Error("Too many mailboxes to match a sender address safely.");
    for (const mailbox of mailboxes) {
      const address = mailbox.email.trim().toLowerCase();
      if (input.senderMailboxes.includes(address)) {
        mailboxOwners.set(mailbox.user_id, [...(mailboxOwners.get(mailbox.user_id) ?? []), address]);
      }
    }
  }

  const leadIdsByOwner = new Map<string, string[]>();
  for (const lead of leads) {
    leadIdsByOwner.set(lead.user_id, [...(leadIdsByOwner.get(lead.user_id) ?? []), lead.id]);
  }

  const candidates = unique([...leadIdsByOwner.keys(), ...mailboxOwners.keys()]);
  const selected = input.ownerIds.length > 0 ? input.ownerIds : candidates;
  const excludedCandidates = candidates.filter((userId) => !selected.includes(userId));

  const existingByOwner = new Map<string, string>();
  const openByLead = new Map<string, string[]>();
  if (selected.length > 0) {
    const { data: suppressions, error } = await supabase
      .from("suppressions")
      .select("user_id, reason")
      .eq("email", input.email)
      .in("user_id", selected);
    if (error) throw error;
    for (const suppression of suppressions) existingByOwner.set(suppression.user_id, suppression.reason);

    const selectedLeadIds = selected.flatMap((userId) => leadIdsByOwner.get(userId) ?? []);
    if (selectedLeadIds.length > 0) {
      const { data: enrollments, error: enrollmentsError } = await supabase
        .from("campaign_leads")
        .select("id, lead_id")
        .in("lead_id", selectedLeadIds)
        .in("status", OPEN_ENROLLMENT_STATUSES);
      if (enrollmentsError) throw enrollmentsError;
      for (const enrollment of enrollments) {
        openByLead.set(enrollment.lead_id, [...(openByLead.get(enrollment.lead_id) ?? []), enrollment.id]);
      }
    }
  }

  const targets = selected.map((userId): RemovalTarget => {
    const leadIds = leadIdsByOwner.get(userId) ?? [];
    return {
      userId,
      leadIds,
      senderMailboxes: mailboxOwners.get(userId) ?? [],
      existingSuppression: existingByOwner.get(userId) ?? null,
      openEnrollmentIds: leadIds.flatMap((leadId) => openByLead.get(leadId) ?? []),
    };
  });

  const plan = { projectUrl, email: input.email, requestRef: input.requestRef, targets, excludedCandidates };
  return { ...plan, digest: removalPlanDigest(plan) };
}

// Suppressions first, for every target, then enrollments: the suppression is
// what blocks future sends (enrolment warning, claim time, pre-send check),
// so it must hold even if a later step fails. Safe to repeat.
export async function applyRemovalPlan(supabase: Client, plan: RemovalPlan): Promise<RemovalTargetResult[]> {
  if (plan.targets.length === 0) throw new Error("This plan has no accounts to apply it to.");

  const created = new Set<string>();
  for (const target of plan.targets) {
    if (target.existingSuppression) continue;
    const { error } = await supabase
      .from("suppressions")
      .insert({ user_id: target.userId, email: plan.email, reason: "manual" });
    if (error && !isUniqueViolation(error)) throw error;
    if (!error) created.add(target.userId);
  }

  // The person objected, so they also leave the Polimatiq verified pool for
  // everyone — otherwise the next allocation could deliver them to new
  // customers. The pool's own suppression trigger only reacts to
  // unsubscribe/bounce suppressions, not to these 'manual' ones, so it's done
  // here. Covers retired rows too: a suppressed lead can never be reactivated.
  const { error: poolError } = await supabase
    .from("verified_leads")
    .update({ status: "suppressed", suppressed_at: new Date().toISOString(), suppressed_reason: "removal_request" })
    .eq("email", plan.email)
    .in("status", ["active", "retired"]);
  if (poolError) throw poolError;

  const stopped = new Map<string, number>();
  for (const target of plan.targets) {
    if (target.openEnrollmentIds.length === 0) continue;
    // Only enrollments still open: one that completed or replied in the
    // meantime keeps its real outcome.
    const { data, error } = await supabase
      .from("campaign_leads")
      .update({ status: "unsubscribed", next_send_at: null, locked_until: null })
      .in("id", target.openEnrollmentIds)
      .in("status", OPEN_ENROLLMENT_STATUSES)
      .select("id");
    if (error) throw error;
    stopped.set(target.userId, data.length);
  }

  const { data: confirmed, error } = await supabase
    .from("suppressions")
    .select("user_id, reason")
    .eq("email", plan.email)
    .in(
      "user_id",
      plan.targets.map((target) => target.userId),
    );
  if (error) throw error;
  const reasonByOwner = new Map(confirmed.map((row) => [row.user_id, row.reason]));
  const missing = plan.targets.filter((target) => !reasonByOwner.has(target.userId));
  if (missing.length > 0) {
    throw new Error(`Suppression not found after writing it for: ${missing.map((target) => target.userId).join(", ")}`);
  }

  return plan.targets.map((target) => ({
    userId: target.userId,
    suppression: created.has(target.userId) ? "created" : "already_suppressed",
    reason: reasonByOwner.get(target.userId) ?? "",
    stoppedEnrollments: stopped.get(target.userId) ?? 0,
  }));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
