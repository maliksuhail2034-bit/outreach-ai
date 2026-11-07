"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import type { Tables } from "@/types/database.types";
import { sequenceStepSchema, type SequenceStepInput } from "@/lib/validations/sequence-steps";
import {
  createSequenceStepAction,
  discardUnlinkedAttachmentsAction,
  linkAttachmentsToStepAction,
  updateSequenceStepAction,
} from "@/app/(app)/campaigns/[campaignId]/actions";
import { unwrapActionResult } from "@/lib/action-result";
import { findMalformedTags, findUnsupportedTags } from "@/lib/email/validate-template";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isStepCondition } from "@/lib/email/step-conditions";
import { CONDITION_OPTIONS } from "./step-timeline";
import { TemplatePicker } from "./template-picker";
import { MergeTagPicker } from "./merge-tag-picker";
import { TemplateValidationList } from "./template-validation-list";
import { EmailPreviewDialog } from "./email-preview-dialog";
import { EmailPreviewPane } from "./email-preview-pane";
import { AttachmentManager, type AttachmentSummary } from "./attachment-manager";
import { ComposerEditor, type ComposerEditorHandle } from "./composer-editor";

type SequenceStepFormProps = (
  | {
      mode: "create";
      campaignId: string;
      step?: undefined;
      onSuccess?: () => void;
    }
  | {
      mode: "edit";
      campaignId: string;
      step: Tables<"sequence_steps">;
      onSuccess?: () => void;
    }
) & {
  templates: Tables<"templates">[];
  existingAttachments?: AttachmentSummary[];
  earlierSteps: EarlierStepOption[];
};

// The steps that come before this one, which its condition can refer to.
export interface EarlierStepOption {
  id: string;
  number: number;
  subject: string | null;
}

// Radix Select can't hold "" as a value; "any" stands for "any earlier email".
const ANY_EARLIER_STEP = "any";

type ActiveField = "subject" | "body";

export function SequenceStepForm({
  mode,
  campaignId,
  step,
  templates,
  existingAttachments = [],
  earlierSteps,
  onSuccess,
}: SequenceStepFormProps) {
  const [isPending, startTransition] = useTransition();

  // Attachments upload immediately (see AttachmentManager/uploadAttachmentAction)
  // and are only linked to this step on a successful Save — this list is the
  // current set of attachment ids/metadata for the step being edited,
  // starting from whatever was already linked (edit mode) plus anything
  // uploaded during this session.
  const [attachments, setAttachments] = useState<AttachmentSummary[]>(existingAttachments);
  // Ids uploaded during this dialog session that are NOT yet linked to a
  // step — if the dialog closes without a successful save, these are
  // discarded (see the unmount effect below) so an uploaded-then-abandoned
  // file doesn't sit around forever with nothing referencing it. Ids that
  // were already linked when the form opened (existingAttachments) are
  // never in this set, so they're never at risk of this cleanup.
  const uploadedThisSessionRef = useRef<Set<string>>(new Set());

  // Whether the save-and-link sequence below completed. A plain ref write
  // inside the submit handler itself (passed to form.handleSubmit) trips
  // React Compiler's ref-safety check — "may read/write a ref during
  // render" — since the compiler can't prove handleSubmit won't invoke it
  // synchronously. So the submit handler only ever calls the state setter
  // below; a separate effect mirrors that state into this ref, which the
  // unmount-only cleanup effect (further down) reads. Both ref accesses
  // happen inside effects, never inside a function passed to handleSubmit.
  const [saveSucceeded, setSaveSucceeded] = useState(false);
  const saveSucceededRef = useRef(false);
  useEffect(() => {
    saveSucceededRef.current = saveSucceeded;
  }, [saveSucceeded]);

  useEffect(() => {
    return () => {
      if (saveSucceededRef.current) return;
      // uploadedThisSessionRef.current is a long-lived accumulator Set
      // (mutated in place via .add(), never reassigned) — reading it here
      // at cleanup time reflects every upload from this session, not a
      // stale snapshot, so there's nothing to copy into a local variable.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
      const idsToDiscard = [...uploadedThisSessionRef.current];
      if (idsToDiscard.length > 0) {
        void discardUnlinkedAttachmentsAction(idsToDiscard).catch(() => {});
      }
    };
    // Intentionally empty deps — this must run its cleanup exactly once, on
    // unmount (dialog close), not on every re-render.
  }, []);

  const form = useForm<SequenceStepInput>({
    resolver: zodResolver(sequenceStepSchema),
    defaultValues:
      mode === "edit"
        ? {
            dayDelay: step.day_delay,
            subject: step.subject ?? "",
            body: step.body ?? "",
            condition: isStepCondition(step.condition) ? step.condition : "always",
            conditionStepId: step.condition_step_id ?? "",
          }
        : {
            // A follow-up defaults to 3 days later; the first email to the day the lead is enrolled.
            dayDelay: earlierSteps.length > 0 ? 3 : 0,
            subject: "",
            body: "",
            condition: "always",
            conditionStepId: "",
          },
  });

  // The variable picker inserts into whichever of Subject/Body the user
  // last focused — tracked here rather than guessed, since both fields
  // accept merge tags (a subject line like "Quick question about
  // {{company}}" is a common real pattern, not just the body).
  const [activeField, setActiveField] = useState<ActiveField>("body");
  const subjectEditorRef = useRef<ComposerEditorHandle | null>(null);
  const bodyEditorRef = useRef<ComposerEditorHandle | null>(null);

  const subjectValue = useWatch({ control: form.control, name: "subject" }) ?? "";
  const bodyValue = useWatch({ control: form.control, name: "body" }) ?? "";
  const conditionValue = useWatch({ control: form.control, name: "condition" }) ?? "always";
  // The live preview trails typing slightly, so rendering it never slows the editor.
  const previewSubject = useDeferredValue(subjectValue);
  const previewBody = useDeferredValue(bodyValue);

  // Live, non-blocking hints as the user types — reuses the canonical
  // renderer via validate-template.ts (Batch 1) rather than re-parsing
  // {{...}} here. Missing-data-across-enrolled-leads isn't checked here (no
  // lead list at this scope) — that's surfaced once, aggregated, in
  // CampaignReviewStep.
  const validationIssues = useMemo(
    () => [...findMalformedTags(subjectValue), ...findMalformedTags(bodyValue), ...findUnsupportedTags(subjectValue, bodyValue)],
    [subjectValue, bodyValue],
  );

  // Inserts a variable chip at the cursor of the last-focused field; the
  // editor's own update then writes the new value into the form.
  function insertMergeTag(tag: string) {
    const editor = activeField === "subject" ? subjectEditorRef.current : bodyEditorRef.current;
    editor?.insertMergeTag(tag);
  }

  function onSubmit(values: SequenceStepInput) {
    startTransition(async () => {
      try {
        const stepId = mode === "create" ? (await createSequenceStepAction(campaignId, values)).id : step.id;
        if (mode === "edit") {
          await updateSequenceStepAction(campaignId, step.id, values);
        }

        // Links whatever's currently attached (existing survivors + this
        // session's uploads) to the now-guaranteed-to-exist step. Removed
        // attachments are already gone (removeAttachmentAction deletes
        // immediately — see AttachmentManager), so `attachments` here is
        // exactly the step's final attachment set, not a diff.
        if (attachments.length > 0) {
          unwrapActionResult(
            await linkAttachmentsToStepAction(
              campaignId,
              stepId,
              attachments.map((attachment) => attachment.id),
            ),
          );
        }
        setSaveSucceeded(true);

        toast.success(mode === "create" ? "Step added." : "Step updated.");
        onSuccess?.();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : mode === "create"
              ? "Couldn't add the step. Try again."
              : "Couldn't update the step. Try again.",
        );
      }
    });
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]"
      >
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="step-timing" className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
            <h3 id="step-timing" className="text-sm font-semibold">
              When to send
            </h3>
            <div className="grid gap-4 sm:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)]">
              <FormField
                control={form.control}
                name="dayDelay"
                render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>{earlierSteps.length > 0 ? "Wait" : "Send after"}</FormLabel>
                    <div className="flex items-center gap-2">
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          max={365}
                          className="w-20"
                          name={field.name}
                          ref={field.ref}
                          value={field.value}
                          onBlur={field.onBlur}
                          onChange={(e) => field.onChange(e.target.valueAsNumber)}
                        />
                      </FormControl>
                      <span className="text-sm text-muted-foreground">days</span>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {earlierSteps.length > 0 && (
                <FormField
                  control={form.control}
                  name="condition"
                  render={({ field }) => (
                    <FormItem className="min-w-0">
                      <FormLabel>Send this step</FormLabel>
                      <Select value={field.value ?? "always"} onValueChange={field.onChange} disabled={isPending}>
                        <FormControl>
                          <SelectTrigger className="w-full min-w-0">
                            <span className="min-w-0 truncate">
                              <SelectValue />
                            </span>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {CONDITION_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {earlierSteps.length > 0 && conditionValue !== "always" && (
                <FormField
                  control={form.control}
                  name="conditionStepId"
                  render={({ field }) => (
                    <FormItem className="min-w-0">
                      <FormLabel>Which email</FormLabel>
                      <Select
                        value={field.value ? field.value : ANY_EARLIER_STEP}
                        onValueChange={(value) => field.onChange(value === ANY_EARLIER_STEP ? "" : value)}
                        disabled={isPending}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full min-w-0">
                            <span className="min-w-0 truncate">
                              <SelectValue />
                            </span>
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={ANY_EARLIER_STEP}>Any earlier email</SelectItem>
                          {earlierSteps.map((earlier) => (
                            <SelectItem key={earlier.id} value={earlier.id}>
                              Step {earlier.number}
                              {earlier.subject ? `: ${earlier.subject}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {earlierSteps.length === 0
                ? "The first email. 0 days sends it in the campaign's next sending hours after a lead is added."
                : conditionValue === "always"
                  ? "Counted from the last email this lead actually received, inside the campaign's sending hours."
                  : "Leads who don't match skip this step and move on. Scanner opens and clicks don't count. For a different follow-up to non-openers, add a second step with the same wait set to the opposite condition."}
            </p>
          </section>

          <section aria-labelledby="step-email" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="step-email" className="text-sm font-semibold">
                Email
              </h3>
              <div className="lg:hidden">
                <EmailPreviewDialog subject={subjectValue} body={bodyValue} attachments={attachments} />
              </div>
            </div>

            <TemplatePicker templates={templates} setValue={form.setValue} />

            <FormField
              control={form.control}
              name="subject"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Subject</FormLabel>
                  <FormControl>
                    <ComposerEditor
                      ref={subjectEditorRef}
                      variant="subject"
                      ariaLabel="Subject"
                      placeholder="Quick question about your team"
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      onFocus={() => setActiveField("subject")}
                      disabled={isPending}
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
                  <FormLabel>Message</FormLabel>
                  <FormControl>
                    <ComposerEditor
                      ref={bodyEditorRef}
                      variant="body"
                      ariaLabel="Body"
                      placeholder="Hi {{first_name}}, ..."
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      onFocus={() => setActiveField("body")}
                      disabled={isPending}
                      toolbarExtra={<MergeTagPicker onInsert={insertMergeTag} disabled={isPending} />}
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    Variables go where you last clicked. Select text for bold, italic or a link. Enter starts a new
                    paragraph, Shift+Enter a new line.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <AttachmentManager
              attachments={attachments}
              onChange={setAttachments}
              onUploaded={(id) => uploadedThisSessionRef.current.add(id)}
              disabled={isPending}
            />

            <TemplateValidationList issues={validationIssues} />
          </section>
        </div>

        <aside aria-label="Live preview" className="hidden min-w-0 lg:block">
          <div className="sticky top-0 space-y-2">
            <h3 className="text-sm font-semibold">Live preview</h3>
            <EmailPreviewPane subject={previewSubject} body={previewBody} attachments={attachments} />
          </div>
        </aside>

        <DialogFooter className="lg:col-span-2">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : mode === "create" ? "Add step" : "Save changes"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
