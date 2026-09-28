"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getEmailReplyThread, markEmailRepliesRead } from "@/lib/db";

// Marks every unread reply in the conversation containing replyId as read.
// Reachable by direct POST like any Server Function, so it checks the
// session itself, resolves the conversation through RLS (another user's
// reply is not found), and writes only read_at (markEmailRepliesRead) — the
// one column authenticated users may update. Already-read replies are left
// alone, so repeating it is harmless.
export async function markConversationReadAction(replyId: string) {
  await requireUser();
  if (typeof replyId !== "string") throw new Error("Reply not found.");

  const supabase = await createClient();
  const thread = await getEmailReplyThread(supabase, replyId);
  if (!thread) throw new Error("Reply not found.");

  const unreadIds = thread.replies.filter((reply) => reply.read_at === null).map((reply) => reply.id);
  if (unreadIds.length === 0) return;

  await markEmailRepliesRead(supabase, unreadIds);
  revalidatePath("/inbox");
}
