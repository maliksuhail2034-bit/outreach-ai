import { ImapFlow, type ListResponse } from "imapflow";

import { normalizeMessageId } from "@/lib/email/message-id";
import { friendlyImapTimeoutMessage, IMAP_TIMEOUTS, resolveImapConnection } from "@/lib/email/reply-providers/imap";
import type { Tables } from "@/types/database.types";

// The recipient side of warmup, run once per cycle on each warmup mailbox
// over a single IMAP session. It does what Instantly/Lemlist warmup does on
// the receiving end:
//
//   1. Detects newly arrived warmup mail in the INBOX (envelope only — it
//      never downloads message bodies, and never reads or changes any
//      message that isn't one of our own warmup emails).
//   2. Engages with it: marks it read, and stars a share of it, the
//      positive-engagement signals mailbox providers use for reputation.
//   3. Finds warmup mail that landed in the spam/junk folder, by its exact
//      Message-ID, and moves it back to the inbox — the "not spam" signal
//      that actually repairs a sender's reputation — recording the
//      placement so inbox-placement rate can be reported.
//
// Its own cursor (warmup_profiles.imap_last_uid / imap_uid_validity) is
// separate from the reply-sync pipeline's (mailboxes.imap_last_uid), so the
// two never race on the same mailbox.

export interface InboxAgentCursor {
  uidValidity: number | null;
  lastUid: number | null;
}

export interface PendingPlacement {
  // warmup_messages.provider_message_id, normalized (no angle brackets).
  providerMessageId: string;
}

export interface PlacementResult {
  providerMessageId: string;
  placement: "inbox" | "spam";
  rescued: boolean;
}

export interface InboxAgentResult {
  cursor: { uidValidity: number; lastUid: number };
  // Warmup messages newly seen in the inbox this cycle (including ones just
  // rescued from spam), for the reply-decision step.
  arrivedMessageIds: string[];
  placements: PlacementResult[];
}

export interface InboxAgentOptions {
  cursor: InboxAgentCursor;
  // Recent warmup mail addressed to this mailbox whose placement isn't
  // known yet — what to look for in spam.
  pending: PendingPlacement[];
  // Which of these Message-IDs are our own warmup emails. Called once per
  // cycle with every new INBOX arrival; the agent touches nothing else.
  identifyWarmupMessages: (messageIds: string[]) => Promise<Set<string>>;
  // Probability a warmup email is starred, in [0, 1].
  starProbability?: number;
  random?: () => number;
  // Dry run: look (fetch envelopes, search spam) but change nothing in the
  // mailbox — no flags, no moves. Placements are still reported.
  readOnly?: boolean;
}

// Bounds the per-cycle IMAP work regardless of backlog size.
const MAX_SPAM_SEARCHES_PER_CYCLE = 25;
const SPAM_FOLDER_NAME_PATTERN = /^(spam|junk|junk e-?mail|junk mail|bulk mail|bulk)$/i;

export function findSpamFolder(folders: Pick<ListResponse, "path" | "name" | "specialUse">[]): string | null {
  const bySpecialUse = folders.find((folder) => folder.specialUse === "\\Junk");
  if (bySpecialUse) return bySpecialUse.path;
  return folders.find((folder) => SPAM_FOLDER_NAME_PATTERN.test(folder.name))?.path ?? null;
}

export async function runInboxAgent(mailbox: Tables<"mailboxes">, options: InboxAgentOptions): Promise<InboxAgentResult> {
  const random = options.random ?? Math.random;
  const starProbability = options.starProbability ?? 0.25;
  const connection = await resolveImapConnection(mailbox);
  const client = new ImapFlow({ ...connection, ...IMAP_TIMEOUTS, logger: false });

  try {
    await client.connect();

    const inbox = await scanInbox(client, options, random, starProbability);
    const placements: PlacementResult[] = inbox.arrivedMessageIds.map((providerMessageId) => ({
      providerMessageId,
      placement: "inbox" as const,
      rescued: false,
    }));

    const seen = new Set(inbox.arrivedMessageIds);
    const stillMissing = options.pending
      .map((pending) => pending.providerMessageId)
      .filter((id) => !seen.has(id))
      .slice(0, MAX_SPAM_SEARCHES_PER_CYCLE);

    const rescued = stillMissing.length > 0 ? await rescueFromSpam(client, stillMissing, options.readOnly ?? false) : [];
    for (const providerMessageId of rescued) {
      placements.push({ providerMessageId, placement: "spam", rescued: true });
    }

    return {
      cursor: inbox.cursor,
      arrivedMessageIds: [...inbox.arrivedMessageIds, ...rescued],
      placements,
    };
  } catch (error) {
    const friendly = friendlyImapTimeoutMessage(error);
    if (friendly) throw new Error(friendly);
    throw error;
  } finally {
    await client.logout().catch(() => undefined);
  }
}

async function scanInbox(
  client: ImapFlow,
  options: InboxAgentOptions,
  random: () => number,
  starProbability: number,
): Promise<{ cursor: { uidValidity: number; lastUid: number }; arrivedMessageIds: string[] }> {
  const lock = await client.getMailboxLock("INBOX");
  try {
    if (!client.mailbox) throw new Error("IMAP server did not report mailbox status after selecting INBOX.");

    const uidValidity = Number(client.mailbox.uidValidity);
    const highestUid = Math.max(client.mailbox.uidNext - 1, 0);
    const { cursor } = options;
    const neverSynced = cursor.lastUid === null || cursor.uidValidity === null;
    const uidValidityChanged = !neverSynced && cursor.uidValidity !== uidValidity;

    // First run (or the server renumbered the mailbox): start from "now"
    // rather than replaying the whole mailbox; pending placements are
    // still found by the Message-ID searches below.
    if (neverSynced || uidValidityChanged || cursor.lastUid! + 1 > highestUid) {
      return { cursor: { uidValidity, lastUid: neverSynced || uidValidityChanged ? highestUid : cursor.lastUid! }, arrivedMessageIds: [] };
    }

    const arrivals: { uid: number; messageId: string }[] = [];
    let lastUid = cursor.lastUid!;
    for await (const message of client.fetch(`${cursor.lastUid! + 1}:*`, { uid: true, envelope: true }, { uid: true })) {
      if (message.uid) lastUid = Math.max(lastUid, message.uid);
      const messageId = normalizeMessageId(message.envelope?.messageId);
      if (message.uid && messageId) arrivals.push({ uid: message.uid, messageId });
    }

    if (arrivals.length === 0) return { cursor: { uidValidity, lastUid }, arrivedMessageIds: [] };

    const warmupIds = await options.identifyWarmupMessages(arrivals.map((arrival) => arrival.messageId));
    const warmupArrivals = arrivals.filter((arrival) => warmupIds.has(arrival.messageId));

    if (warmupArrivals.length > 0 && !options.readOnly) {
      const uids = warmupArrivals.map((arrival) => arrival.uid);
      await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
      const starred = uids.filter(() => random() < starProbability);
      if (starred.length > 0) await client.messageFlagsAdd(starred, ["\\Flagged"], { uid: true });
    }

    return { cursor: { uidValidity, lastUid }, arrivedMessageIds: warmupArrivals.map((arrival) => arrival.messageId) };
  } finally {
    lock.release();
  }
}

// Returns the Message-IDs found in spam and (unless readOnly) moved to the
// inbox.
async function rescueFromSpam(client: ImapFlow, providerMessageIds: string[], readOnly: boolean): Promise<string[]> {
  const spamFolder = findSpamFolder(await client.list());
  if (!spamFolder) return [];

  const rescued: string[] = [];
  const lock = await client.getMailboxLock(spamFolder);
  try {
    for (const providerMessageId of providerMessageIds) {
      const uids = await client.search({ header: { "message-id": providerMessageId } }, { uid: true });
      if (!uids || uids.length === 0) continue;
      if (readOnly) {
        rescued.push(providerMessageId);
        continue;
      }
      // Read + moved to the inbox: the closest IMAP equivalent of clicking
      // "Not spam", which is what retrains the provider's filter.
      await client.messageFlagsAdd(uids, ["\\Seen"], { uid: true });
      await client.messageMove(uids, "INBOX", { uid: true });
      rescued.push(providerMessageId);
    }
  } finally {
    lock.release();
  }
  return rescued;
}
