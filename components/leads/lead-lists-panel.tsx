"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FolderPlusIcon, PencilIcon, Trash2Icon } from "lucide-react";

import type { Tables } from "@/types/database.types";
import { deleteLeadListAction } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { LeadListForm } from "./lead-list-form";

type LeadList = Tables<"lead_lists"> & { leadCount: number };

export function LeadListsPanel({ leadLists }: { leadLists: LeadList[] }) {
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<LeadList | null>(null);
  const [deleting, setDeleting] = useState<LeadList | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();

  function handleDelete() {
    if (!deleting) return;
    const target = deleting;
    startDeleteTransition(async () => {
      try {
        await deleteLeadListAction(target.id);
        toast.success("List removed.");
        setDeleting(null);
      } catch {
        toast.error("Couldn't remove the list. Try again.");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>Lists</CardTitle>
          <CardDescription>Group leads into named segments.</CardDescription>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <FolderPlusIcon />
              New list
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New lead list</DialogTitle>
              <DialogDescription>Give this segment a name to group leads under it.</DialogDescription>
            </DialogHeader>
            <LeadListForm mode="create" onSuccess={() => setAddOpen(false)} />
          </DialogContent>
        </Dialog>
      </CardHeader>

      <CardContent>
        {leadLists.length === 0 ? (
          <p className="text-sm text-muted-foreground">No lists yet. Leads can still be added without one.</p>
        ) : (
          <ul className="divide-y divide-border">
            {leadLists.map((list) => (
              <li key={list.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate font-medium">{list.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {list.leadCount} {list.leadCount === 1 ? "lead" : "leads"}
                    {list.description ? ` · ${list.description}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${list.name}`}
                    onClick={() => setEditing(list)}
                  >
                    <PencilIcon className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${list.name}`}
                    onClick={() => setDeleting(list)}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit list</DialogTitle>
            <DialogDescription>Update this list&apos;s name or description.</DialogDescription>
          </DialogHeader>
          {editing && <LeadListForm mode="edit" leadList={editing} onSuccess={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove list?</DialogTitle>
            <DialogDescription>
              This removes &ldquo;{deleting?.name}&rdquo;. Leads in it aren&apos;t deleted — they&apos;re just
              unassigned from the list.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? "Removing…" : "Remove list"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
