// Template-level validation for a sequence step's subject/body — surfaced
// live in the composer (components/sequences/sequence-step-form.tsx) and
// aggregated across every step in the campaign review step
// (components/campaigns/campaign-review-step.tsx), so a user can catch
// personalization problems before a campaign starts sending.
//
// Deliberately reuses lib/email/render-email.ts's canonical renderEmailContent
// for tag resolution instead of re-parsing {{...}} itself — see Batch 1.
// The only genuinely new parsing here is the malformed-single-brace
// heuristic below, which the canonical {{double-brace}} pattern doesn't (and
// shouldn't) attempt to recognize at all: a single "{tag}" just isn't a
// match for it, so nothing about it is duplicated.
import { renderEmailContent } from "./render-email";
import type { MergeTagLead } from "./merge-tags";
import { SAMPLE_LEAD } from "./sample-lead";

export type TemplateValidationIssueType = "unsupported_tag" | "malformed_tag" | "missing_data";

export interface TemplateValidationIssue {
  type: TemplateValidationIssueType;
  message: string;
  tag?: string;
}

// A single-brace group that reads like an attempted merge tag ("{first_name}",
// "{First Name}"). A genuine {{double-brace}} tag never matches this: the
// negative lookahead right after each brace bails out the instant a second
// brace is adjacent, so "{{first_name}}" is skipped entirely (see this
// module's tests for the exact double-brace cases this excludes).
const SINGLE_BRACE_TAG_PATTERN = /\{(?!\{)([A-Za-z][A-Za-z0-9_ ]{0,40})\}(?!\})/g;

function countOccurrences(text: string, token: string): number {
  return text.split(token).length - 1;
}

// Flags obviously-broken personalization syntax that the canonical
// {{...}} pattern silently ignores (it just isn't a match, nothing to
// report) rather than surfaces — fine for rendering (there's nothing there
// to substitute), not fine for a user who meant to write a merge tag and
// mistyped it.
export function findMalformedTags(text: string): TemplateValidationIssue[] {
  if (!text) return [];
  const issues: TemplateValidationIssue[] = [];

  if (countOccurrences(text, "{{") !== countOccurrences(text, "}}")) {
    issues.push({
      type: "malformed_tag",
      message: "This email has an unmatched {{ or }} — double-check your merge tags.",
    });
  }

  const seen = new Set<string>();
  for (const match of text.matchAll(SINGLE_BRACE_TAG_PATTERN)) {
    const inner = match[1].trim();
    if (!inner || seen.has(inner)) continue;
    seen.add(inner);
    issues.push({
      type: "malformed_tag",
      tag: inner,
      message: `"{${inner}}" looks like a merge tag with a brace missing — did you mean "{{${inner}}}"?`,
    });
  }

  return issues;
}

// Tags that resolve to nothing because the tag name itself isn't
// recognized. Renders against SAMPLE_LEAD (a fully-populated fake lead) so
// nothing here is ever falsely flagged just for lacking data — that's
// findMissingDataAcrossLeads's job, kept separate on purpose (see
// TemplateValidationIssueType).
export function findUnsupportedTags(subject: string, body: string): TemplateValidationIssue[] {
  const rendered = renderEmailContent(subject, body, SAMPLE_LEAD);
  return rendered.unsupportedTags.map((tag) => ({
    type: "unsupported_tag" as const,
    tag,
    message: `"{{${tag}}}" isn't a supported merge tag — it will send as blank text.`,
  }));
}

// Caps how many enrolled leads findMissingDataAcrossLeads actually renders
// against — this is a diagnostic, not the send path, and a campaign can
// have thousands of enrolled leads (see app/(app)/campaigns/[campaignId]/page.tsx's
// 10,000-row lead fetch). Large enough that the count it reports is
// meaningful, small enough that it stays cheap to compute on every render.
const MISSING_DATA_SAMPLE_SIZE = 500;

// Cross-references every merge tag actually used across the given steps
// against a sample of the campaign's already-enrolled leads (no new query —
// the caller passes whatever lead rows it already loaded) and flags a tag
// whenever at least one of them has no value for it. Skipped entirely when
// no leads are passed, so this never fires for a template still being
// drafted before anyone is enrolled.
export function findMissingDataAcrossLeads(
  steps: { subject?: string | null; body?: string | null }[],
  leads: MergeTagLead[],
): TemplateValidationIssue[] {
  if (leads.length === 0) return [];
  const sample = leads.slice(0, MISSING_DATA_SAMPLE_SIZE);

  const missingCounts = new Map<string, number>();
  for (const step of steps) {
    for (const lead of sample) {
      const rendered = renderEmailContent(step.subject ?? "", step.body ?? "", lead);
      for (const tag of rendered.missingTags) {
        if (rendered.unsupportedTags.includes(tag)) continue;
        missingCounts.set(tag, (missingCounts.get(tag) ?? 0) + 1);
      }
    }
  }

  const checkedLabel = sample.length < leads.length ? `first ${sample.length} enrolled leads` : `${sample.length} enrolled lead${sample.length === 1 ? "" : "s"}`;

  return [...missingCounts.entries()].map(([tag, count]) => ({
    type: "missing_data" as const,
    tag,
    message: `{{${tag}}} has no value for ${count} of the ${checkedLabel} checked — it will send blank for them.`,
  }));
}

// Aggregate entry point for the campaign review step: every unique issue
// across every step's subject/body, deduplicated by (type, tag/message) so
// the same mistake reused across several steps surfaces once, not once per
// step.
export function validateSequenceTemplates(
  steps: { subject?: string | null; body?: string | null }[],
  leads: MergeTagLead[] = [],
): TemplateValidationIssue[] {
  const all: TemplateValidationIssue[] = [];
  for (const step of steps) {
    all.push(...findMalformedTags(step.subject ?? ""));
    all.push(...findMalformedTags(step.body ?? ""));
    all.push(...findUnsupportedTags(step.subject ?? "", step.body ?? ""));
  }
  all.push(...findMissingDataAcrossLeads(steps, leads));

  const deduped: TemplateValidationIssue[] = [];
  const seenKeys = new Set<string>();
  for (const issue of all) {
    const key = `${issue.type}:${issue.tag ?? issue.message}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    deduped.push(issue);
  }
  return deduped;
}
