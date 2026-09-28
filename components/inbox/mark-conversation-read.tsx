"use client";

import { useEffect } from "react";

import { markConversationReadAction } from "@/app/(app)/inbox/[replyId]/actions";

// Opening a conversation marks its unread replies read. A Server Function
// rather than a write during the page render, which can't revalidate the
// inbox; the action re-checks auth and ownership itself.
export function MarkConversationRead({ replyId, hasUnread }: { replyId: string; hasUnread: boolean }) {
  useEffect(() => {
    if (!hasUnread) return;
    markConversationReadAction(replyId).catch((error: unknown) => {
      console.error("[inbox] marking the conversation read failed", error);
    });
  }, [replyId, hasUnread]);

  return null;
}
