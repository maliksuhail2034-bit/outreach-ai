"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import type { Tables } from "@/types/database.types";
import { leadListSchema, type LeadListInput } from "@/lib/validations/lead-lists";
import { createLeadListAction, updateLeadListAction } from "@/app/(app)/leads/actions";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type LeadListFormProps =
  | { mode: "create"; leadList?: undefined; onSuccess: () => void }
  | { mode: "edit"; leadList: Tables<"lead_lists">; onSuccess: () => void };

export function LeadListForm({ mode, leadList, onSuccess }: LeadListFormProps) {
  const [isPending, startTransition] = useTransition();
  const form = useForm<LeadListInput>({
    resolver: zodResolver(leadListSchema),
    defaultValues:
      mode === "edit"
        ? { name: leadList.name, description: leadList.description ?? "" }
        : { name: "", description: "" },
  });

  function onSubmit(values: LeadListInput) {
    startTransition(async () => {
      try {
        if (mode === "create") {
          await createLeadListAction(values);
          toast.success("List created.");
        } else {
          await updateLeadListAction(leadList.id, values);
          toast.success("List updated.");
        }
        onSuccess();
      } catch {
        toast.error(mode === "create" ? "Couldn't create the list. Try again." : "Couldn't update the list. Try again.");
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="Q3 conference leads" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea rows={3} placeholder="Optional notes about this list" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <DialogFooter>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : mode === "create" ? "Create list" : "Save changes"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
