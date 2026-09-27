// Canonical variable picker options (components/sequences/merge-tag-picker.tsx):
// the human-friendly label shown in the composer UI paired with the exact
// canonical tag lib/email/merge-tags.ts resolves. Insertion always writes the
// canonical snake_case syntax ({{first_name}}) — never a user-facing alias —
// so a sequence step's stored body always uses the one syntax the renderer
// treats as a first-class hit, even though merge-tags.ts separately also
// accepts alias spellings a user might type by hand (e.g. {{First Name}}).
import { isSupportedMergeTag } from "./merge-tags";

export interface MergeTagOption {
  label: string;
  tag: string;
}

export const MERGE_TAG_OPTIONS: MergeTagOption[] = [
  { label: "First Name", tag: "first_name" },
  { label: "Full Name", tag: "full_name" },
  { label: "Company", tag: "company" },
  { label: "Email", tag: "email" },
  { label: "Job Title", tag: "job_title" },
];

export function mergeTagSyntax(tag: string): string {
  return `{{${tag}}}`;
}

export interface MergeTagChip {
  label: string;
  supported: boolean;
}

// What a variable chip in the composer shows: the picker's friendly label
// for a canonical tag, otherwise the tag as typed, flagged when the renderer
// wouldn't recognize it (it then renders as an empty string, same as ever).
export function mergeTagChip(tag: string): MergeTagChip {
  const option = MERGE_TAG_OPTIONS.find((candidate) => candidate.tag === tag);
  return { label: option?.label ?? tag, supported: isSupportedMergeTag(tag) };
}
