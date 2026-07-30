"use client";

import type { UseFormSetValue } from "react-hook-form";

import type { Tables } from "@/types/database.types";
import type { SequenceStepInput } from "@/lib/validations/sequence-steps";
import { FormItem, FormLabel } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Template = Tables<"templates">;

// Presentation only: copies a template's subject/body into the step form's
// existing fields on selection (copy-on-select — no persistent link is
// stored, so editing a template later never retroactively changes a step
// that was created from it). Selecting a template doesn't submit anything;
// the subject/body fields stay exactly as editable as before, just
// pre-filled. Renders nothing when there are no templates to pick from.
export function TemplatePicker({
  templates,
  setValue,
}: {
  templates: Template[];
  setValue: UseFormSetValue<SequenceStepInput>;
}) {
  if (templates.length === 0) return null;

  function applyTemplate(templateId: string) {
    const template = templates.find((candidate) => candidate.id === templateId);
    if (!template) return;

    setValue("subject", template.subject ?? "", { shouldDirty: true, shouldValidate: true });
    setValue("body", template.body ?? "", { shouldDirty: true, shouldValidate: true });
  }

  return (
    <FormItem>
      <FormLabel>Insert from template</FormLabel>
      <Select onValueChange={applyTemplate}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Choose a template to insert" />
        </SelectTrigger>
        <SelectContent>
          {templates.map((template) => (
            <SelectItem key={template.id} value={template.id}>
              {template.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FormItem>
  );
}
