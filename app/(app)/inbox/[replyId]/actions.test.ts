import { beforeEach, describe, expect, it, vi } from "vitest";

// Same "mock the seam" approach as app/(app)/campaigns/actions.test.ts — only
// the auth/DB boundary is mocked.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/supabase/auth", () => ({
  requireUser: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({})),
}));
vi.mock("@/lib/db", () => ({
  getEmailReplyThread: vi.fn(),
  markEmailRepliesRead: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/supabase/auth";
import { getEmailReplyThread, markEmailRepliesRead } from "@/lib/db";
import type { InboxReply } from "@/lib/db/email-replies";
import { markConversationReadAction } from "./actions";

const REPLY_ID = "11111111-1111-4111-8111-111111111111";

function reply(id: string, readAt: string | null): InboxReply {
  return {
    id,
    campaign_id: "campaign-1",
    lead_id: "lead-1",
    mailbox_id: "mailbox-1",
    subject: null,
    from_email: "lead@example.com",
    from_name: null,
    to_emails: [],
    body_text: "hi",
    received_at: "2026-09-20T10:00:00.000Z",
    read_at: readAt,
    lead: null,
    campaign: null,
    mailbox: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue({ id: "user-1" } as never);
  vi.mocked(markEmailRepliesRead).mockResolvedValue(undefined);
});

describe("markConversationReadAction", () => {
  it("requires a signed-in user before touching anything", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("Unauthorized: no authenticated user."));

    await expect(markConversationReadAction(REPLY_ID)).rejects.toThrow("Unauthorized");
    expect(getEmailReplyThread).not.toHaveBeenCalled();
    expect(markEmailRepliesRead).not.toHaveBeenCalled();
  });

  it("marks only the conversation's still-unread replies, then revalidates the inbox", async () => {
    vi.mocked(getEmailReplyThread).mockResolvedValue({
      campaignId: "campaign-1",
      leadId: "lead-1",
      replies: [reply("r-1", "2026-09-21T00:00:00.000Z"), reply("r-2", null), reply("r-3", null)],
    });

    await markConversationReadAction(REPLY_ID);

    expect(getEmailReplyThread).toHaveBeenCalledWith(expect.anything(), REPLY_ID);
    expect(markEmailRepliesRead).toHaveBeenCalledWith(expect.anything(), ["r-2", "r-3"]);
    expect(revalidatePath).toHaveBeenCalledWith("/inbox");
  });

  it("is a harmless no-op when everything is already read", async () => {
    vi.mocked(getEmailReplyThread).mockResolvedValue({
      campaignId: "campaign-1",
      leadId: "lead-1",
      replies: [reply("r-1", "2026-09-21T00:00:00.000Z")],
    });

    await expect(markConversationReadAction(REPLY_ID)).resolves.toBeUndefined();
    expect(markEmailRepliesRead).not.toHaveBeenCalled();
  });

  it("refuses a reply the caller can't see (missing or another user's — RLS returns no thread)", async () => {
    vi.mocked(getEmailReplyThread).mockResolvedValue(null);

    await expect(markConversationReadAction(REPLY_ID)).rejects.toThrow("Reply not found.");
    expect(markEmailRepliesRead).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a non-string id sent by a direct POST", async () => {
    await expect(markConversationReadAction(42 as unknown as string)).rejects.toThrow("Reply not found.");
    expect(getEmailReplyThread).not.toHaveBeenCalled();
  });
});
