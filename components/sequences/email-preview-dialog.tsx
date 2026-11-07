"use client";

import { useState, type ReactNode } from "react";
import { EyeIcon } from "lucide-react";

import type { AttachmentSummary } from "./attachment-manager";
import { EmailPreviewPane } from "./email-preview-pane";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// The inbox-style preview (EmailPreviewPane) in a dialog, for places with no
// room for it inline: a step in the sequence list, and the step editor on
// narrow screens. Rendered only while open, so typing never pays for it.
export function EmailPreviewDialog({
  subject,
  body,
  attachments = [],
  trigger,
}: {
  subject: string;
  body: string;
  attachments?: AttachmentSummary[];
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="outline" size="sm">
            <EyeIcon />
            Preview
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Email preview</DialogTitle>
          <DialogDescription>How this email looks in the recipient&apos;s inbox.</DialogDescription>
        </DialogHeader>
        {open && <EmailPreviewPane subject={subject} body={body} attachments={attachments} />}
      </DialogContent>
    </Dialog>
  );
}
