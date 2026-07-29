"use client";

import { useActionState, useState } from "react";
import { UploadIcon } from "lucide-react";

import type { Tables } from "@/types/database.types";
import { importLeadsAction } from "@/app/(app)/leads/import-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NO_LIST = "none";

export function CsvImportDialog({ leadLists }: { leadLists: Tables<"lead_lists">[] }) {
  const [open, setOpen] = useState(false);
  const [listId, setListId] = useState(NO_LIST);
  const [state, formAction, isPending] = useActionState(importLeadsAction, undefined);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <UploadIcon />
          Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import leads from CSV</DialogTitle>
          <DialogDescription>
            Columns recognized: first_name, last_name, email (required), company, title.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="listId" value={listId === NO_LIST ? "" : listId} />

          <div className="space-y-2">
            <Label htmlFor="csv-list">Add to list</Label>
            <Select value={listId} onValueChange={setListId}>
              <SelectTrigger className="w-full" id="csv-list">
                <SelectValue placeholder="No list" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_LIST}>No list</SelectItem>
                {leadLists.map((list) => (
                  <SelectItem key={list.id} value={list.id}>
                    {list.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="csv-file">CSV file</Label>
            <Input id="csv-file" name="file" type="file" accept=".csv,text/csv" required />
          </div>

          {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

          {state && !state.error && (
            <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
              <p className="font-medium">Import complete</p>
              <ul className="mt-2 space-y-1 text-muted-foreground">
                <li>Imported: {state.imported}</li>
                <li>Skipped duplicates: {state.skippedDuplicates}</li>
                <li>Failed: {state.failed}</li>
              </ul>
              {state.failedRows.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {state.failedRows.map((row) => (
                    <li key={row.row}>
                      Row {row.row}: {row.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Importing…" : "Import"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
