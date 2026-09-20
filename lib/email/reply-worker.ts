import type { Client } from "@/lib/db/shared";
import type { Tables } from "@/types/database.types";
import {
  claimMailboxesForReplySync,
  getCampaignLeadByCampaignAndLead,
  getEmailEventByProviderMessageId,
  getEmailReplyByEventId,
  getLeadById,
  listActiveCampaignLeadsForMailbox,
  listLeadIdsByEmail,
  recordEmailEvent,
  recordEmailReply,
  releaseMailboxReplySyncLock,
  updateCampaignLead,
  updateLead,
  updateMailboxSyncCursor,
} from "@/lib/db";
import { getReplyProvider } from "./get-reply-provider";
import type { ReplyMessage } from "./reply-provider";
import { captureError } from "@/lib/monitoring/error-tracking";

// Lead-level status is only ever advanced to 'replied' from these two
// states — never overwrites a human's own 'qualified'/'unqualified' call.
// See the plan §3.
const LEAD_STATUSES_ELIGIBLE_FOR_REPLIED = new Set(["new", "contacted"]);

export interface ReplySyncSummary {
  mailboxesChecked: number;
  messagesFetched: number;
  matched: number;
  unmatched: number;
  alreadyRecorded: number;
}

type ProcessOutcome = "matched" | "unmatched" | "alreadyRecorded";

interface ReplyMatch {
  campaignId: string;
  leadId: string;
  campaignLeadId: string;
  matchedVia: "header" | "address-fallback";
}

// Orchestration only — mirrors lib/email/send-worker.ts's shape exactly.
// Sequential across mailboxes (not parallel), a deliberate choice to avoid
// tripping provider-side IMAP connection/rate limits — see the plan §6.
export async function runReplySyncWorker(supabase: Client): Promise<ReplySyncSummary> {
  const summary: ReplySyncSummary = {
    mailboxesChecked: 0,
    messagesFetched: 0,
    matched: 0,
    unmatched: 0,
    alreadyRecorded: 0,
  };

  // Atomic claim (see claim_mailboxes_for_reply_sync()) instead of a plain
  // select — a slow previous run still holding a mailbox's lease is skipped
  // rather than double-processed by an overlapping invocation. Reliability
  // Track item 6.
  const mailboxes = await claimMailboxesForReplySync(supabase);

  for (const mailbox of mailboxes) {
    summary.mailboxesChecked += 1;

    let result;
    try {
      result = await getReplyProvider(mailbox).fetchNewMessages();
    } catch (error) {
      // One mailbox's IMAP failure (auth, network, throttling) must not
      // stop the others in this run — now logged (Phase 3 Enterprise
      // Readiness audit, P0) so a persistently failing mailbox is visible
      // instead of silently never syncing replies again.
      const message = error instanceof Error ? error.message : "Unknown error.";
      console.error("[reply-worker]", { mailboxId: mailbox.id, error: message });
      await captureError({ job: "sync-replies", message, context: { mailboxId: mailbox.id } });
      // Release the claim rather than leaving it locked for the full lease —
      // the next scheduled run is this pipeline's only retry mechanism, so
      // holding the lock any longer would just delay that retry with no
      // benefit.
      await releaseMailboxReplySyncLock(supabase, mailbox.id).catch(() => undefined);
      continue;
    }

    summary.messagesFetched += result.messages.length;

    for (const message of result.messages) {
      const outcome = await processInboundMessage(supabase, mailbox, message);
      summary[outcome] += 1;
    }

    await updateMailboxSyncCursor(supabase, mailbox.id, result.cursor);
  }

  return summary;
}

// The single entry point for reply business logic — matching, the
// idempotency check, and the three-table write. Every arrival mechanism
// (today's IMAP polling loop above, a future webhook handler) is required
// to funnel through this one function; it has zero knowledge of IMAP,
// Gmail, or Graph specifics, only the provider-agnostic ReplyMessage shape.
// See the plan's normalization contract.
async function processInboundMessage(
  supabase: Client,
  mailbox: Tables<"mailboxes">,
  message: ReplyMessage,
): Promise<ProcessOutcome> {
  // Cheap pre-check first — the real guarantee against a duplicate
  // 'replied' row is the DB-level partial unique index
  // (email_events_replied_message_id_key), not this check, which only
  // avoids redundant matching work in the common case.
  const alreadyRecorded = await getEmailEventByProviderMessageId(supabase, message.messageId, "replied");
  if (alreadyRecorded) {
    // The event was recorded, but a prior run may have crashed between that
    // insert and persisting this message's content (or this exact message
    // is being re-delivered by the provider) — persistReplyContent is
    // idempotent per email_event_id, so backfilling here is always safe and
    // never produces a second email_replies row.
    await persistReplyContent(supabase, alreadyRecorded, message);
    return "alreadyRecorded";
  }

  const match = await matchReply(supabase, mailbox, message);
  if (!match) return "unmatched";

  let emailEvent: Tables<"email_events">;
  try {
    emailEvent = await recordEmailEvent(supabase, {
      campaign_id: match.campaignId,
      lead_id: match.leadId,
      mailbox_id: mailbox.id,
      event_type: "replied",
      provider_message_id: message.messageId,
      metadata: {
        inReplyTo: message.inReplyTo,
        references: message.references,
        matchedVia: match.matchedVia,
        fromAddress: message.from.email,
      },
    });
  } catch (error) {
    // A concurrent run winning the same insert is the unique index doing
    // its job, not an error from this function's perspective — see plan §4.
    // The concurrent run may not have persisted the reply content yet
    // either, so fetch its row and (idempotently) backfill from here too.
    if (isUniqueViolation(error)) {
      const winningEvent = await getEmailEventByProviderMessageId(supabase, message.messageId, "replied");
      if (winningEvent) await persistReplyContent(supabase, winningEvent, message);
      return "alreadyRecorded";
    }
    throw error;
  }

  await persistReplyContent(supabase, emailEvent, message);

  await updateCampaignLead(supabase, match.campaignLeadId, {
    status: "replied",
    current_step_id: null,
    next_send_at: null,
  });

  const lead = await getLeadById(supabase, match.leadId);
  if (LEAD_STATUSES_ELIGIBLE_FOR_REPLIED.has(lead.status)) {
    await updateLead(supabase, mailbox.user_id, match.leadId, { status: "replied" });
  }

  return "matched";
}

// Persists the reply's content (subject/from/to/body — see the reply
// content persistence batch) exactly once per email_events row. Called from
// every path that can reach a 'replied' event — a fresh insert, a
// concurrent run's winning insert, or an already-recorded event from a
// prior run — so content is backfilled if an earlier attempt recorded the
// event but crashed before persisting its content, without ever risking a
// second email_replies row for the same email_event_id: checked here, and
// backstopped by email_replies_email_event_id_key at the DB level.
async function persistReplyContent(
  supabase: Client,
  emailEvent: Tables<"email_events">,
  message: ReplyMessage,
): Promise<void> {
  const existing = await getEmailReplyByEventId(supabase, emailEvent.id);
  if (existing) return;

  try {
    await recordEmailReply(supabase, {
      email_event_id: emailEvent.id,
      campaign_id: emailEvent.campaign_id,
      lead_id: emailEvent.lead_id,
      // Always set on a 'replied' event — recordEmailEvent above (and any
      // other writer of a 'replied' row) always passes mailbox_id.
      mailbox_id: emailEvent.mailbox_id!,
      subject: message.subject,
      from_email: message.from.email,
      from_name: message.from.name ?? null,
      to_emails: message.to.map((address) => address.email),
      body_text: message.bodyText,
      body_html: message.bodyHtml,
      received_at: message.receivedAt,
    });
  } catch (error) {
    // Another concurrent call already won the insert for this
    // email_event_id — the unique index doing its job, not an error here.
    if (!isUniqueViolation(error)) throw error;
  }
}

// Priority order per the plan §2: In-Reply-To, then References (most
// recent parent first), then a bounded/unambiguous From-address fallback.
// Returns null rather than guessing the moment any step is ambiguous.
async function matchReply(
  supabase: Client,
  mailbox: Tables<"mailboxes">,
  message: ReplyMessage,
): Promise<ReplyMatch | null> {
  const headerCandidates = [message.inReplyTo, ...[...message.references].reverse()].filter(
    (id): id is string => id !== null,
  );

  for (const candidateId of headerCandidates) {
    const sentEvent = await getEmailEventByProviderMessageId(supabase, candidateId, "sent");
    if (!sentEvent) continue;

    const campaignLead = await getCampaignLeadByCampaignAndLead(supabase, sentEvent.campaign_id, sentEvent.lead_id);
    if (!campaignLead) continue;

    return {
      campaignId: sentEvent.campaign_id,
      leadId: sentEvent.lead_id,
      campaignLeadId: campaignLead.id,
      matchedVia: "header",
    };
  }

  const candidateLeadIds = await listLeadIdsByEmail(supabase, mailbox.user_id, message.from.email);
  if (candidateLeadIds.length === 0) return null;

  const candidateCampaignLeads = await listActiveCampaignLeadsForMailbox(supabase, mailbox.id, candidateLeadIds);
  if (candidateCampaignLeads.length !== 1) return null; // zero or ambiguous — never guess

  const matched = candidateCampaignLeads[0];
  return {
    campaignId: matched.campaign_id,
    leadId: matched.lead_id,
    campaignLeadId: matched.id,
    matchedVia: "address-fallback",
  };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
