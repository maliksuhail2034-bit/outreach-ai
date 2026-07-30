import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

import { decryptSmtpPassword } from "@/lib/crypto/smtp-secret";
import type { Tables } from "@/types/database.types";
import type { FetchResult, ReplyMessage, ReplyProvider, SyncCursor } from "../reply-provider";

type Mailbox = Tables<"mailboxes">;

function normalizeMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^</, "").replace(/>$/, "");
}

function normalizeReferences(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : raw.split(/\s+/);
  return list.map((id) => normalizeMessageId(id)).filter((id): id is string => id !== null);
}

// The only IMAP/MIME-specific code in the codebase — everything it returns
// is already translated into the provider-agnostic ReplyMessage shape (see
// ../reply-provider.ts). No IMAP type or field crosses out of this file.
// Reuses lib/crypto/smtp-secret.ts as-is for the IMAP password: the
// functions are generic AES-256-GCM string encryption despite the name,
// nothing SMTP-specific inside.
export class ImapReplyChecker implements ReplyProvider {
  constructor(private readonly mailbox: Mailbox) {}

  async fetchNewMessages(): Promise<FetchResult> {
    const password = decryptSmtpPassword(this.mailbox.encrypted_imap_password ?? "");

    const client = new ImapFlow({
      host: this.mailbox.imap_host ?? "",
      port: this.mailbox.imap_port,
      secure: true,
      auth: { user: this.mailbox.imap_username ?? "", pass: password },
      logger: false,
    });

    await client.connect();
    try {
      return await this.syncInbox(client);
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  private async syncInbox(client: ImapFlow): Promise<FetchResult> {
    const lock = await client.getMailboxLock("INBOX");
    try {
      if (!client.mailbox) {
        throw new Error("IMAP server did not report mailbox status after selecting INBOX.");
      }

      const currentUidValidity = Number(client.mailbox.uidValidity);
      const highestUid = client.mailbox.uidNext - 1;

      const neverSynced = this.mailbox.imap_last_uid === null || this.mailbox.imap_uid_validity === null;
      const uidValidityChanged = !neverSynced && this.mailbox.imap_uid_validity !== currentUidValidity;

      if (neverSynced || uidValidityChanged) {
        // First sync, or the folder's UIDVALIDITY changed underneath us
        // (e.g. a provider-side mailbox rebuild) — start watching from now,
        // never scan history. See the plan's "first-sync scope" risk note.
        const cursor: SyncCursor = { uidValidity: currentUidValidity, lastUid: Math.max(highestUid, 0) };
        return { messages: [], cursor };
      }

      const fromUid = this.mailbox.imap_last_uid! + 1;
      if (fromUid > highestUid) {
        return { messages: [], cursor: { uidValidity: currentUidValidity, lastUid: highestUid } };
      }

      const messages: ReplyMessage[] = [];
      let sawUid = highestUid;

      for await (const message of client.fetch(`${fromUid}:*`, { uid: true, source: true }, { uid: true })) {
        if (message.uid) sawUid = Math.max(sawUid, message.uid);
        if (!message.source) continue;

        const parsed = await simpleParser(message.source);
        const messageId = normalizeMessageId(parsed.messageId);
        if (!messageId) continue; // no Message-ID — skip, never synthesize one

        const fromAddress = Array.isArray(parsed.from) ? parsed.from[0]?.value?.[0] : parsed.from?.value?.[0];
        if (!fromAddress?.address) continue;

        messages.push({
          messageId,
          inReplyTo: normalizeMessageId(parsed.inReplyTo),
          references: normalizeReferences(parsed.references),
          from: { name: fromAddress.name || undefined, email: fromAddress.address },
          subject: parsed.subject ?? null,
          receivedAt: (parsed.date ?? new Date()).toISOString(),
        });
      }

      return { messages, cursor: { uidValidity: currentUidValidity, lastUid: sawUid } };
    } finally {
      lock.release();
    }
  }
}
