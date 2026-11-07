"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2Icon } from "lucide-react";

import type { Tables } from "@/types/database.types";
import { addLeadNoteAction, deleteLeadNoteAction } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const dateFormatter = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

export function LeadNotes({ leadId, notes }: { leadId: string; notes: Tables<"lead_notes">[] }) {
  const [body, setBody] = useState("");
  const [isSaving, startSaveTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function handleAdd() {
    const text = body.trim();
    if (!text) return;
    startSaveTransition(async () => {
      try {
        await addLeadNoteAction(leadId, { body: text });
        setBody("");
      } catch {
        toast.error("Couldn't save the note. Try again.");
      }
    });
  }

  async function handleDelete(noteId: string) {
    setDeletingId(noteId);
    try {
      await deleteLeadNoteAction(leadId, noteId);
    } catch {
      toast.error("Couldn't delete the note. Try again.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notes</CardTitle>
        <CardDescription>Calls, meetings and anything else worth remembering. Only you can see them.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="lead-note" className="sr-only">
            New note
          </Label>
          <Textarea
            id="lead-note"
            value={body}
            maxLength={5000}
            rows={3}
            placeholder="Add a note"
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) handleAdd();
            }}
            disabled={isSaving}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={handleAdd} disabled={isSaving || body.trim() === ""}>
              {isSaving ? "Saving…" : "Add note"}
            </Button>
          </div>
        </div>

        {notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {notes.map((note) => (
              <li key={note.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-sm break-words whitespace-pre-wrap">{note.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{dateFormatter.format(new Date(note.created_at))}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete note"
                  disabled={deletingId === note.id}
                  onClick={() => handleDelete(note.id)}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
