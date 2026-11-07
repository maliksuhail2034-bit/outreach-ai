import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tables } from "@/types/database.types";

// A fake IMAP server: an INBOX with a few new messages (one ours, one a
// real customer email) and a Gmail-style spam folder holding one of our
// warmup emails.
const imap = vi.hoisted(() => ({
  flagsAdded: [] as { mailbox: string; uids: number[]; flags: string[] }[],
  moved: [] as { mailbox: string; uids: number[]; to: string }[],
  selected: "",
}));

vi.mock("@/lib/email/reply-providers/imap", () => ({
  IMAP_TIMEOUTS: {},
  friendlyImapTimeoutMessage: () => null,
  resolveImapConnection: vi.fn(async () => ({ host: "imap.test", port: 993, secure: true, auth: { user: "u", pass: "p" } })),
}));

vi.mock("imapflow", () => {
  class ImapFlow {
    mailbox: { uidValidity: bigint; uidNext: number } | null = null;
    async connect() {}
    async logout() {}
    async list() {
      return [
        { path: "INBOX", name: "INBOX", specialUse: "\\Inbox" },
        { path: "[Gmail]/Spam", name: "Spam", specialUse: "\\Junk" },
      ];
    }
    async getMailboxLock(path: string) {
      imap.selected = path;
      this.mailbox = path === "INBOX" ? { uidValidity: BigInt(7), uidNext: 13 } : { uidValidity: BigInt(9), uidNext: 3 };
      return { release: () => undefined };
    }
    async *fetch() {
      yield { uid: 11, envelope: { messageId: "<warmup-in-inbox@test>" } };
      yield { uid: 12, envelope: { messageId: "<customer-real-mail@test>" } };
    }
    async search(query: { header: Record<string, string> }) {
      return query.header["message-id"] === "warmup-in-spam@test" ? [2] : [];
    }
    async messageFlagsAdd(uids: number[], flags: string[]) {
      imap.flagsAdded.push({ mailbox: imap.selected, uids, flags });
      return true;
    }
    async messageMove(uids: number[], to: string) {
      imap.moved.push({ mailbox: imap.selected, uids, to });
      return {};
    }
  }
  return { ImapFlow };
});

import { runInboxAgent } from "./inbox-agent";

const MAILBOX = { id: "mb-1", email: "b@test" } as Tables<"mailboxes">;

function options(overrides: Partial<Parameters<typeof runInboxAgent>[1]> = {}) {
  return {
    cursor: { uidValidity: 7, lastUid: 10 },
    pending: [{ providerMessageId: "warmup-in-inbox@test" }, { providerMessageId: "warmup-in-spam@test" }],
    identifyWarmupMessages: async (ids: string[]) => new Set(ids.filter((id) => id.startsWith("warmup-"))),
    random: () => 0, // always star
    ...overrides,
  };
}

beforeEach(() => {
  imap.flagsAdded.length = 0;
  imap.moved.length = 0;
});

describe("runInboxAgent", () => {
  it("engages only with our own warmup mail and rescues spam-filed warmup mail", async () => {
    const result = await runInboxAgent(MAILBOX, options());

    expect(result.cursor).toEqual({ uidValidity: 7, lastUid: 12 });
    expect(result.placements).toEqual([
      { providerMessageId: "warmup-in-inbox@test", placement: "inbox", rescued: false },
      { providerMessageId: "warmup-in-spam@test", placement: "spam", rescued: true },
    ]);
    expect(result.arrivedMessageIds).toEqual(["warmup-in-inbox@test", "warmup-in-spam@test"]);

    // The customer's real email (uid 12) is never flagged or moved.
    const touchedInboxUids = imap.flagsAdded.filter((entry) => entry.mailbox === "INBOX").flatMap((entry) => entry.uids);
    expect(touchedInboxUids).not.toContain(12);
    expect(imap.flagsAdded).toContainEqual({ mailbox: "INBOX", uids: [11], flags: ["\\Seen"] });
    expect(imap.flagsAdded).toContainEqual({ mailbox: "INBOX", uids: [11], flags: ["\\Flagged"] });
    expect(imap.moved).toEqual([{ mailbox: "[Gmail]/Spam", uids: [2], to: "INBOX" }]);
  });

  it("changes nothing in the mailbox in read-only (dry-run) mode, but still reports placement", async () => {
    const result = await runInboxAgent(MAILBOX, options({ readOnly: true }));

    expect(imap.flagsAdded).toEqual([]);
    expect(imap.moved).toEqual([]);
    expect(result.placements.map((placement) => placement.placement)).toEqual(["inbox", "spam"]);
  });

  it("starts from the current position on first sync instead of replaying the mailbox", async () => {
    const result = await runInboxAgent(MAILBOX, options({ cursor: { uidValidity: null, lastUid: null }, pending: [] }));

    expect(result.cursor).toEqual({ uidValidity: 7, lastUid: 12 });
    expect(result.arrivedMessageIds).toEqual([]);
    expect(imap.flagsAdded).toEqual([]);
  });
});
