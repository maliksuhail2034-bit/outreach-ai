"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { PlusIcon, Trash2Icon } from "lucide-react";

import type { Tables } from "@/types/database.types";
import { createLeadSegmentAction, updateLeadSegmentAction } from "@/app/(app)/leads/segment-actions";
import {
  MAX_SEGMENT_RULES,
  SEGMENT_TEXT_FIELDS,
  leadSegmentRulesSchema,
  leadSegmentSchema,
  type LeadSegmentRule,
} from "@/lib/validations/lead-segments";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  FIELD_LABELS,
  defaultRule,
  enumValuesFor,
  operatorsFor,
  segmentFormErrors,
  withEnumValue,
  withField,
  withOperator,
  type Field,
} from "./segment-rule-editing";

type LeadList = Tables<"lead_lists">;

const OPERATOR_LABELS: Record<string, string> = {
  is: "is",
  is_not: "is not",
  in: "is one of",
  not_in: "is not one of",
  equals: "equals",
  contains: "contains",
  before: "is before",
  after: "is after",
};

const VALUE_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  replied: "Replied",
  qualified: "Qualified",
  unqualified: "Unqualified",
  unverified: "Unverified",
  pending: "Pending",
  valid: "Valid",
  invalid: "Invalid",
  catch_all: "Catch-all",
  unknown: "Unknown",
  error: "Error",
};

// Stored rules re-validated for editing; list ids whose list has since been
// deleted are dropped (they could never match again, and the database
// would refuse to save them).
function initialRules(raw: unknown, leadLists: LeadList[]): { rules: LeadSegmentRule[]; notice?: string } {
  const parsed = leadSegmentRulesSchema.safeParse(raw);
  if (!parsed.success) {
    return { rules: [], notice: "This segment's saved rules are no longer valid. Add its rules again." };
  }
  const listIds = new Set(leadLists.map((list) => list.id));
  let dropped = false;
  const rules = parsed.data.map((rule) => {
    if (rule.field !== "list_id") return rule;
    const values = rule.values.filter((id) => listIds.has(id));
    if (values.length !== rule.values.length) dropped = true;
    return { ...rule, values };
  });
  return { rules, notice: dropped ? "A list this segment used has been deleted and was removed from its rules." : undefined };
}

type SegmentFormProps =
  | { mode: "create"; segment?: undefined; leadLists: LeadList[]; onSuccess: () => void }
  | { mode: "edit"; segment: Tables<"lead_segments">; leadLists: LeadList[]; onSuccess: () => void };

export function SegmentForm({ mode, segment, leadLists, onSuccess }: SegmentFormProps) {
  const formId = useId();
  const [isPending, startTransition] = useTransition();
  const [initial] = useState(() =>
    mode === "edit" ? initialRules(segment.rules, leadLists) : { rules: [defaultRule("status")], notice: undefined },
  );
  const [name, setName] = useState(mode === "edit" ? segment.name : "");
  const [description, setDescription] = useState(mode === "edit" ? (segment.description ?? "") : "");
  const [rules, setRules] = useState<LeadSegmentRule[]>(initial.rules);
  // Errors stay hidden until the first failed submit, then track the current
  // form state so a fixed rule doesn't keep its stale message.
  const [showErrors, setShowErrors] = useState(false);
  const errors = showErrors ? segmentFormErrors({ name, description, rules }) : [];

  function updateRule(index: number, next: LeadSegmentRule) {
    setRules((current) => current.map((rule, i) => (i === index ? next : rule)));
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = leadSegmentSchema.safeParse({ name, description, rules });
    if (!parsed.success) {
      setShowErrors(true);
      return;
    }
    startTransition(async () => {
      try {
        if (mode === "create") {
          await createLeadSegmentAction(parsed.data);
          toast.success("Segment created.");
        } else {
          await updateLeadSegmentAction(segment.id, parsed.data);
          toast.success("Segment updated.");
        }
        onSuccess();
      } catch {
        toast.error(mode === "create" ? "Couldn't create the segment. Try again." : "Couldn't update the segment. Try again.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor={`${formId}-name`}>Name</Label>
        <Input
          id={`${formId}-name`}
          placeholder="Verified leads at Acme"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${formId}-description`}>Description</Label>
        <Textarea
          id={`${formId}-description`}
          rows={2}
          placeholder="Optional notes about this segment"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Rules</legend>
        <p className="text-sm text-muted-foreground">
          A lead is in this segment when it matches every rule. Text matching ignores case; dates are in UTC.
        </p>
        {initial.notice && (
          <p role="status" className="text-sm text-muted-foreground">
            {initial.notice}
          </p>
        )}
        {rules.map((rule, index) => (
          <RuleRow
            key={index}
            index={index}
            rule={rule}
            leadLists={leadLists}
            onChange={(next) => updateRule(index, next)}
            onRemove={() => setRules((current) => current.filter((_, i) => i !== index))}
          />
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={rules.length >= MAX_SEGMENT_RULES}
          onClick={() => setRules((current) => [...current, defaultRule("status")])}
        >
          <PlusIcon />
          Add rule
        </Button>
      </fieldset>

      {errors.length > 0 && (
        <ul role="alert" className="space-y-1 text-sm text-destructive">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <DialogFooter>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : mode === "create" ? "Create segment" : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function RuleRow({
  index,
  rule,
  leadLists,
  onChange,
  onRemove,
}: {
  index: number;
  rule: LeadSegmentRule;
  leadLists: LeadList[];
  onChange: (rule: LeadSegmentRule) => void;
  onRemove: () => void;
}) {
  const label = `Rule ${index + 1}`;
  // A rejected transient Select value returns the rule unchanged; skipping it
  // keeps a possibly stale rule object from being written back.
  const change = (next: LeadSegmentRule) => {
    if (next !== rule) onChange(next);
  };
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={rule.field} onValueChange={(field) => change(withField(rule, field))}>
          <SelectTrigger size="sm" aria-label={`${label} field`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(FIELD_LABELS) as Field[]).map((field) => (
              <SelectItem key={field} value={field}>
                {FIELD_LABELS[field]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={rule.operator} onValueChange={(operator) => change(withOperator(rule, operator))}>
          <SelectTrigger size="sm" aria-label={`${label} condition`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {operatorsFor(rule.field).map((operator) => (
              <SelectItem key={operator} value={operator}>
                {OPERATOR_LABELS[operator]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" variant="ghost" size="icon" className="ml-auto" aria-label={`Remove ${label.toLowerCase()}`} onClick={onRemove}>
          <Trash2Icon className="size-4" />
        </Button>
      </div>
      <RuleValue label={label} rule={rule} leadLists={leadLists} onChange={change} />
    </div>
  );
}

function RuleValue({
  label,
  rule,
  leadLists,
  onChange,
}: {
  label: string;
  rule: LeadSegmentRule;
  leadLists: LeadList[];
  onChange: (rule: LeadSegmentRule) => void;
}) {
  if (rule.field === "status" || rule.field === "verification_status") {
    const options = enumValuesFor(rule.field);
    if ("values" in rule) {
      return (
        <CheckboxGroup
          label={`${label} values`}
          options={options.map((value) => ({ value, label: VALUE_LABELS[value] ?? value }))}
          selected={rule.values}
          onChange={(values) => onChange({ ...rule, values } as LeadSegmentRule)}
        />
      );
    }
    return (
      <Select value={rule.value} onValueChange={(value) => onChange(withEnumValue(rule, value))}>
        <SelectTrigger size="sm" aria-label={`${label} value`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((value) => (
            <SelectItem key={value} value={value}>
              {VALUE_LABELS[value] ?? value}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (rule.field === "list_id") {
    if (leadLists.length === 0) {
      return <p className="text-sm text-muted-foreground">You don&apos;t have any lists yet.</p>;
    }
    return (
      <CheckboxGroup
        label={`${label} lists`}
        options={leadLists.map((list) => ({ value: list.id, label: list.name }))}
        selected={rule.values}
        onChange={(values) => onChange({ ...rule, values })}
      />
    );
  }

  if (rule.field === "created_at") {
    return (
      <Input
        type="date"
        aria-label={`${label} date`}
        value={rule.value}
        onChange={(event) => onChange({ ...rule, value: event.target.value })}
      />
    );
  }

  const isTextField = (SEGMENT_TEXT_FIELDS as readonly string[]).includes(rule.field);
  return (
    <Input
      aria-label={`${label} value`}
      placeholder={isTextField ? "Text to match" : "example.com"}
      value={rule.value}
      onChange={(event) => onChange({ ...rule, value: event.target.value } as LeadSegmentRule)}
    />
  );
}

function CheckboxGroup({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: readonly string[];
  onChange: (values: string[]) => void;
}) {
  const groupId = useId();
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-x-4 gap-y-2">
      {options.map((option) => {
        const id = `${groupId}-${option.value}`;
        const checked = selected.includes(option.value);
        return (
          <div key={option.value} className="flex items-center gap-2">
            <input
              id={id}
              type="checkbox"
              className="size-4 rounded-sm border-input accent-primary"
              checked={checked}
              onChange={() =>
                onChange(checked ? selected.filter((value) => value !== option.value) : [...selected, option.value])
              }
            />
            <Label htmlFor={id} className="font-normal">
              {option.label}
            </Label>
          </div>
        );
      })}
    </div>
  );
}
