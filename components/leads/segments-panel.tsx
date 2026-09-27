"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FilterIcon, PencilIcon, Trash2Icon } from "lucide-react";

import type { Tables } from "@/types/database.types";
import { deleteLeadSegmentAction } from "@/app/(app)/leads/segment-actions";
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
import { SegmentForm } from "./segment-form";

// matchCount is null when the segment's stored rules no longer validate.
type Segment = Tables<"lead_segments"> & { matchCount: number | null };

export function SegmentsPanel({
  segments,
  leadLists,
  activeSegmentId,
}: {
  segments: Segment[];
  leadLists: Tables<"lead_lists">[];
  activeSegmentId?: string;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Segment | null>(null);
  const [deleting, setDeleting] = useState<Segment | null>(null);
  const [isDeleting, startDeleteTransition] = useTransition();

  function handleDelete() {
    if (!deleting) return;
    const target = deleting;
    startDeleteTransition(async () => {
      try {
        await deleteLeadSegmentAction(target.id);
        toast.success("Segment removed.");
        setDeleting(null);
      } catch {
        toast.error("Couldn't remove the segment. Try again.");
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>Segments</CardTitle>
          <CardDescription>Leads that match rules, kept up to date automatically.</CardDescription>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <FilterIcon />
              New segment
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>New segment</DialogTitle>
              <DialogDescription>Choose the rules a lead must match to be in this segment.</DialogDescription>
            </DialogHeader>
            <SegmentForm mode="create" leadLists={leadLists} onSuccess={() => setAddOpen(false)} />
          </DialogContent>
        </Dialog>
      </CardHeader>

      <CardContent>
        {segments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No segments yet. A segment shows every lead matching its rules, and can be enrolled into a campaign.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {segments.map((segment) => (
              <li key={segment.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <Link
                    href={`/leads?segment=${segment.id}`}
                    aria-current={segment.id === activeSegmentId ? "true" : undefined}
                    className="block truncate font-medium underline-offset-4 hover:underline aria-[current=true]:underline"
                  >
                    {segment.name}
                  </Link>
                  <p className="truncate text-sm text-muted-foreground">
                    {segment.matchCount === null
                      ? "Rules need updating"
                      : `${segment.matchCount} matching ${segment.matchCount === 1 ? "lead" : "leads"}`}
                    {segment.description ? ` · ${segment.description}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${segment.name}`}
                    onClick={() => setEditing(segment)}
                  >
                    <PencilIcon className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${segment.name}`}
                    onClick={() => setDeleting(segment)}
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
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit segment</DialogTitle>
            <DialogDescription>Update this segment&apos;s name, description or rules.</DialogDescription>
          </DialogHeader>
          {editing && (
            <SegmentForm mode="edit" segment={editing} leadLists={leadLists} onSuccess={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove segment?</DialogTitle>
            <DialogDescription>
              This removes &ldquo;{deleting?.name}&rdquo;. No leads are deleted, and leads already enrolled from it stay
              in their campaigns.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? "Removing…" : "Remove segment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
