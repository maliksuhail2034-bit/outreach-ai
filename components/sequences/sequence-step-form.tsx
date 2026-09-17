"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import type { Tables } from "@/types/database.types";
import { sequenceStepSchema, type SequenceStepInput } from "@/lib/validations/sequence-steps";
import { createSequenceStepAction, updateSequenceStepAction } from "@/app/(app)/campaigns/[campaignId]/actions";
import { insertAtCursor, mergeTagSyntax } from "@/lib/email/merge-tag-options";
import { findMalformedTags, findUnsupportedTags } from "@/lib/email/validate-template";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TemplatePicker } from "./template-picker";
import { MergeTagPicker } from "./merge-tag-picker";
import { TemplateValidationList } from "./template-validation-list";
import { EmailPreviewDialog } from "./email-preview-dialog";

type SequenceStepFormProps = (
  | { mode: "create"; campaignId: string; step?: undefined; onSuccess?: () => void }
  | { mode: "edit"; campaignId: string; step: Tables<"sequence_steps">; onSuccess?: () => void }
) & { templates: Tables<"templates">[] };

type ActiveField = "subject" | "body";

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

  // The variable picker inserts into whichever of Subject/Body the user
  // last focused — tracked here rather than guessed, since both fields
  // accept merge tags (a subject line like "Quick question about
  // {{company}}" is a common real pattern, not just the body).
  const [activeField, setActiveField] = useState<ActiveField>("body");
  const subjectRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const subjectValue = useWatch({ control: form.control, name: "subject" }) ?? "";
  const bodyValue = useWatch({ control: form.control, name: "body" }) ?? "";

  // Live, non-blocking hints as the user types — reuses the canonical
  // renderer via validate-template.ts (Batch 1) rather than re-parsing
  // {{...}} here. Missing-data-across-enrolled-leads isn't checked here (no
  // lead list at this scope) — that's surfaced once, aggregated, in
  // CampaignReviewStep.
  const validationIssues = useMemo(
    () => [...findMalformedTags(subjectValue), ...findMalformedTags(bodyValue), ...findUnsupportedTags(subjectValue, bodyValue)],
    [subjectValue, bodyValue],
  );

  function insertMergeTag(tag: string) {
    const fieldName: ActiveField = activeField;
    const ref = fieldName === "subject" ? subjectRef : bodyRef;
    const el = ref.current;
    const currentValue = form.getValues(fieldName) ?? "";
    const start = el?.selectionStart ?? currentValue.length;
    const end = el?.selectionEnd ?? currentValue.length;
    const { value, cursor } = insertAtCursor(currentValue, mergeTagSyntax(tag), start, end);

    form.setValue(fieldName, value, { shouldDirty: true, shouldValidate: true });

    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(cursor, cursor);
    });
  }

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
                <Input
                  placeholder="Quick question about {{company}}"
                  {...field}
                  ref={(el) => {
                    field.ref(el);
                    subjectRef.current = el;
                  }}
                  onFocus={() => setActiveField("subject")}
                />
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
              <div className="flex items-center justify-between gap-2">
                <FormLabel>Body</FormLabel>
                <EmailPreviewDialog subject={subjectValue} body={bodyValue} />
              </div>
              <MergeTagPicker onInsert={insertMergeTag} />
              <FormControl>
                <Textarea
                  rows={8}
                  placeholder="Hi {{first_name}}, ..."
                  {...field}
                  ref={(el) => {
                    field.ref(el);
                    bodyRef.current = el;
                  }}
                  onFocus={() => setActiveField("body")}
                />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                Paragraphs (blank line between) and line breaks are preserved automatically. A link like
                https://example.com becomes clickable automatically — no special formatting needed.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        <TemplateValidationList issues={validationIssues} />

        <DialogFooter>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : mode === "create" ? "Add step" : "Save changes"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
