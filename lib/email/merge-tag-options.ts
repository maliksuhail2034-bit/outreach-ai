// Canonical variable picker options (components/sequences/merge-tag-picker.tsx):
// the human-friendly label shown in the composer UI paired with the exact
// canonical tag lib/email/merge-tags.ts resolves. Insertion always writes the
// canonical snake_case syntax ({{first_name}}) — never a user-facing alias —
// so a sequence step's stored body always uses the one syntax the renderer
// treats as a first-class hit, even though merge-tags.ts separately also
// accepts alias spellings a user might type by hand (e.g. {{First Name}}).
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

export interface CursorInsertResult {
  value: string;
  // Where the caret should land after the insertion — right after the
  // inserted text, matching how a normal text editor behaves on paste.
  cursor: number;
}

// Pure text-splicing helper behind the variable picker: inserts `insertion`
// in place of the [selectionStart, selectionEnd) range of `value` (an empty
// range is just a caret position; a non-empty one is a replaced selection).
// Extracted out of the picker component so the insertion math itself is
// unit-testable without a DOM/jsdom — the component only needs to read
// selectionStart/selectionEnd off the focused field and call this.
export function insertAtCursor(
  value: string,
  insertion: string,
  selectionStart: number,
  selectionEnd: number,
): CursorInsertResult {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  const nextValue = value.slice(0, start) + insertion + value.slice(end);
  return { value: nextValue, cursor: start + insertion.length };
}
