"use client";

import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import type { Tables } from "@/types/database.types";
import { sequenceStepSchema, type SequenceStepInput } from "@/lib/validations/sequence-steps";
import { createSequenceStepAction, updateSequenceStepAction } from "@/app/(app)/campaigns/[campaignId]/actions";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TemplatePicker } from "./template-picker";

type SequenceStepFormProps = (
  | { mode: "create"; campaignId: string; step?: undefined; onSuccess?: () => void }
  | { mode: "edit"; campaignId: string; step: Tables<"sequence_steps">; onSuccess?: () => void }
) & { templates: Tables<"templates">[] };

export function SequenceStepForm({ mode, campaignId, step, templates, onSuccess }: SequenceStepFormProps) {
  const [isPending, startTransition] = useTransition();

  const form = useForm<SequenceStepInput>({
    resolver: zodResolver(sequenceStepSchema),
    defaultValues:
      mode === "edit"
        ? {
            dayDelay: step.day_delay,
            subject: step.subject ?? "",
            body: step.body ?? "",
          }
        : {
            dayDelay: 0,
            subject: "",
            body: "",
          },
  });

  function onSubmit(values: SequenceStepInput) {
    startTransition(async () => {
      try {
        if (mode === "create") {
          await createSequenceStepAction(campaignId, values);
          toast.success("Step added.");
        } else {
          await updateSequenceStepAction(campaignId, step.id, values);
          toast.success("Step updated.");
        }
        onSuccess?.();
      } catch {
        toast.error(mode === "create" ? "Couldn't add the step. Try again." : "Couldn't update the step. Try again.");
      }
    });
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <TemplatePicker templates={templates} setValue={form.setValue} />

        <FormField
          control={form.control}
          name="dayDelay"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Days after previous step</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  name={field.name}
                  ref={field.ref}
                  value={field.value}
                  onBlur={field.onBlur}
                  onChange={(e) => field.onChange(e.target.valueAsNumber)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="subject"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Subject</FormLabel>
              <FormControl>
                <Input placeholder="Quick question about {{company}}" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="body"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Body</FormLabel>
              <FormControl>
                <Textarea rows={8} placeholder="Hi {{first_name}}, ..." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <DialogFooter>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : mode === "create" ? "Add step" : "Save changes"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
