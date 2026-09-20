"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { BadgeCheckIcon, Trash2Icon } from "lucide-react";

import type { Tables } from "@/types/database.types";
import { deleteLeadAction, verifyLeadAction } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Same verify/delete business logic as components/leads/lead-table.tsx,
// just single-lead and page-level instead of row-level: reuses the exact
// same Server Functions (ownership re-checked there, not here) rather than
// re-implementing either action.
export function LeadDetailActions({ lead }: { lead: Tables<"leads"> }) {
  const router = useRouter();
  const [isVerifying, startVerifyTransition] = useTransition();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();

  function handleVerify() {
    startVerifyTransition(async () => {
      try {
        await verifyLeadAction(lead.id);
      } catch {
        toast.error(`Couldn't verify ${lead.email}. Connect a provider in Settings -> Verification and try again.`);
      }
    });
  }

  function handleDelete() {
    startDeleteTransition(async () => {
      try {
        await deleteLeadAction(lead.id);
        toast.success("Lead removed.");
        // The lead this page is for no longer exists — the list is the only
        // place left to show it, same destination deleteLeadAction's own
        // revalidatePath("/leads") already keeps fresh.
        router.push("/leads");
      } catch {
        toast.error("Couldn't remove the lead. Try again.");
        setDeleteOpen(false);
      }
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" disabled={isVerifying} onClick={handleVerify}>
        <BadgeCheckIcon />
        {isVerifying ? "Verifying…" : "Verify"}
      </Button>
      <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
        <Trash2Icon />
        Delete
      </Button>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove lead?</DialogTitle>
            <DialogDescription>This removes {lead.email} permanently.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? "Removing…" : "Remove lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
