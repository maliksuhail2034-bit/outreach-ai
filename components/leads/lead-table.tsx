"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PencilIcon, Trash2Icon, UserPlusIcon } from "lucide-react";

import type { Tables } from "@/types/database.types";
import { deleteAllLeadsAction, deleteLeadAction, deleteLeadsAction } from "@/app/(app)/leads/actions";
import { Badge } from "@/components/ui/badge";
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
import { CsvImportDialog } from "./csv-import-dialog";
import { LeadForm } from "./lead-form";

type Lead = Tables<"leads">;
type LeadList = Tables<"lead_lists">;

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  new: "outline",
  contacted: "secondary",
  replied: "secondary",
  qualified: "default",
  unqualified: "destructive",
};

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function leadName(lead: Lead) {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ");
  return name || lead.email;
}

export function LeadTable({
  leads,
  leadLists,
  leadCount,
}: {
  leads: Lead[];
  leadLists: LeadList[];
  leadCount: number;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [deleting, setDeleting] = useState<Lead | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [isBulkDeleting, startBulkDeleteTransition] = useTransition();
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [isDeletingAll, startDeleteAllTransition] = useTransition();

  const listNameById = new Map(leadLists.map((list) => [list.id, list.name]));

  // Filters out ids from a previous render's leads (e.g. one that was just
  // deleted individually) so the count never shows stale selections.
  const visibleIds = new Set(leads.map((lead) => lead.id));
  const selectedIds = [...selected].filter((id) => visibleIds.has(id));
  const allSelected = leads.length > 0 && selectedIds.length === leads.length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(visibleIds));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleDelete() {
    if (!deleting) return;
    const target = deleting;
    startDeleteTransition(async () => {
      try {
        await deleteLeadAction(target.id);
        toast.success("Lead removed.");
        setDeleting(null);
      } catch {
        toast.error("Couldn't remove the lead. Try again.");
      }
    });
  }

  function handleBulkDelete() {
    const ids = selectedIds;
    if (ids.length === 0) return;
    startBulkDeleteTransition(async () => {
      try {
        await deleteLeadsAction(ids);
        toast.success(`${ids.length} lead${ids.length === 1 ? "" : "s"} removed.`);
        setSelected(new Set());
        setBulkDeleteOpen(false);
      } catch {
        toast.error("Couldn't remove the selected leads. Try again.");
      }
    });
  }

  function handleDeleteAll() {
    startDeleteAllTransition(async () => {
      try {
        await deleteAllLeadsAction();
        toast.success("All leads removed.");
        setSelected(new Set());
        setDeleteAllOpen(false);
      } catch {
        toast.error("Couldn't remove your leads. Try again.");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>Leads</CardTitle>
          <CardDescription>
            {leadCount > leads.length
              ? `Showing ${leads.length} of ${leadCount} leads.`
              : `${leadCount} lead${leadCount === 1 ? "" : "s"}.`}
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <CsvImportDialog leadLists={leadLists} />
          <Button size="sm" variant="outline" disabled={leadCount === 0} onClick={() => setDeleteAllOpen(true)}>
            <Trash2Icon />
            Delete all
          </Button>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <UserPlusIcon />
                Add lead
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add a lead</DialogTitle>
                <DialogDescription>Add a single prospect to your leads.</DialogDescription>
              </DialogHeader>
              <LeadForm mode="create" leadLists={leadLists} onSuccess={() => setAddOpen(false)} />
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>

      <CardContent>
        {leads.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm font-medium">No leads yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Add a lead or import a CSV to get started.</p>
          </div>
        ) : (
          <>
            {selectedIds.length > 0 && (
              <div className="mb-3 flex items-center justify-between gap-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                <span className="font-medium">
                  {selectedIds.length} selected
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                    Clear
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)}>
                    <Trash2Icon />
                    Delete selected
                  </Button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="w-8 py-2 pr-2">
                      <input
                        type="checkbox"
                        className="size-4 rounded-sm border-input accent-primary"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = selectedIds.length > 0 && !allSelected;
                        }}
                        onChange={toggleAll}
                        aria-label="Select all leads"
                      />
                    </th>
                    <th className="py-2 pr-4 font-medium">Name</th>
                    <th className="py-2 pr-4 font-medium">Company</th>
                    <th className="py-2 pr-4 font-medium">Title</th>
                    <th className="py-2 pr-4 font-medium">List</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pl-4 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {leads.map((lead) => (
                    <tr key={lead.id} className={selected.has(lead.id) ? "bg-muted/30" : undefined}>
                      <td className="py-3 pr-2">
                        <input
                          type="checkbox"
                          className="size-4 rounded-sm border-input accent-primary"
                          checked={selected.has(lead.id)}
                          onChange={() => toggleOne(lead.id)}
                          aria-label={`Select ${leadName(lead)}`}
                        />
                      </td>
                      <td className="max-w-48 truncate py-3 pr-4">
                        <p className="truncate font-medium">{leadName(lead)}</p>
                        <p className="truncate text-xs text-muted-foreground">{lead.email}</p>
                      </td>
                      <td className="max-w-40 truncate py-3 pr-4 text-muted-foreground">{lead.company || "—"}</td>
                      <td className="max-w-40 truncate py-3 pr-4 text-muted-foreground">{lead.title || "—"}</td>
                      <td className="max-w-32 truncate py-3 pr-4 text-muted-foreground">
                        {lead.list_id ? (listNameById.get(lead.list_id) ?? "—") : "—"}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant={STATUS_VARIANT[lead.status] ?? "outline"}>{statusLabel(lead.status)}</Badge>
                      </td>
                      <td className="py-3 pl-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit ${leadName(lead)}`}
                            onClick={() => setEditing(lead)}
                          >
                            <PencilIcon className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Remove ${leadName(lead)}`}
                            onClick={() => setDeleting(lead)}
                          >
                            <Trash2Icon className="size-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit lead</DialogTitle>
            <DialogDescription>Update this lead&apos;s details.</DialogDescription>
          </DialogHeader>
          {editing && (
            <LeadForm mode="edit" lead={editing} leadLists={leadLists} onSuccess={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove lead?</DialogTitle>
            <DialogDescription>This removes {deleting?.email} permanently.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? "Removing…" : "Remove lead"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {selectedIds.length} leads?</DialogTitle>
            <DialogDescription>This removes the selected leads permanently.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)} disabled={isBulkDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleBulkDelete} disabled={isBulkDeleting}>
              {isBulkDeleting ? "Removing…" : `Remove ${selectedIds.length} leads`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteAllOpen} onOpenChange={setDeleteAllOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all leads?</DialogTitle>
            <DialogDescription>
              This permanently deletes all {leadCount} lead{leadCount === 1 ? "" : "s"} in your account, including
              any not shown on this page. This can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteAllOpen(false)} disabled={isDeletingAll}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteAll} disabled={isDeletingAll}>
              {isDeletingAll ? "Deleting…" : "Delete all leads"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
