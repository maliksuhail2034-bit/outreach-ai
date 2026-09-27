"use client";

import { MERGE_TAG_OPTIONS } from "@/lib/email/merge-tag-options";
import { Button } from "@/components/ui/button";

// Compact row of insert buttons — deliberately not a dropdown: five options
// is few enough that one click beats two, and it reads at a glance as part
// of the body's formatting toolbar rather than a hidden menu. Insertion
// itself lives in the caller (it owns the editors and knows which one was
// last focused — see sequence-step-form.tsx); this component only renders
// the options and reports which canonical tag was picked.
export function MergeTagPicker({ onInsert, disabled }: { onInsert: (tag: string) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">Insert variable:</span>
      {MERGE_TAG_OPTIONS.map((option) => (
        <Button
          key={option.tag}
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={disabled}
          onClick={() => onInsert(option.tag)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
