// Pure string-substitution utility for personalizing a sequence step's
// subject/body with lead data. No database access, no provider calls, no
// scheduling or worker logic — this module only transforms strings.

// Deliberately a small local interface rather than importing Tables<"leads">
// from the generated DB types: this keeps the module fully decoupled from
// the schema layer (a real lead row satisfies this structurally regardless).
export interface MergeTagLead {
  first_name?: string | null;
  last_name?: string | null;
  email: string;
  company?: string | null;
  title?: string | null;
  custom_fields?: Record<string, unknown> | null;
}

type MergeTagResolver = (lead: MergeTagLead) => string | null | undefined;

// Adding a future merge tag is exactly one new entry here — no change to
// renderMergeTags, and no change to any caller (the worker just calls
// renderMergeTags the same way regardless of how many tags exist).
const MERGE_TAG_RESOLVERS: Record<string, MergeTagResolver> = {
  first_name: (lead) => lead.first_name,
  last_name: (lead) => lead.last_name,
  full_name: (lead) => [lead.first_name, lead.last_name].filter(Boolean).join(" ") || null,
  email: (lead) => lead.email,
  company: (lead) => lead.company,
  job_title: (lead) => lead.title,
};

export const SUPPORTED_MERGE_TAGS = Object.keys(MERGE_TAG_RESOLVERS);

const MERGE_TAG_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

function getByPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

// custom_fields is arbitrary per-lead enrichment data (see
// supabase/migrations/20260728100050_leads.sql) — {{custom_fields.role}}
// resolves without needing a resolver entry above, so a fully custom merge
// tag never requires a code change at all, not even here.
function resolveTag(tag: string, lead: MergeTagLead): string | null | undefined {
  const resolver = MERGE_TAG_RESOLVERS[tag];
  if (resolver) return resolver(lead);

  if (tag.startsWith("custom_fields.")) {
    const path = tag.split(".").slice(1);
    const value = getByPath(lead.custom_fields ?? {}, path);
    if (value === null || value === undefined) return null;
    return typeof value === "string" ? value : String(value);
  }

  return undefined;
}

export interface RenderMergeTagsResult {
  text: string;
  missingTags: string[];
}

// Replaces every {{tag}} occurrence in `text`. Unknown tags and tags that
// resolve to null/undefined/empty never throw — they fall back to
// `options.fallback` (default: empty string) and are reported in
// missingTags so a caller can log the gap without this module touching any
// storage itself.
export function renderMergeTags(
  text: string,
  lead: MergeTagLead,
  options?: { fallback?: string },
): RenderMergeTagsResult {
  const fallback = options?.fallback ?? "";
  const missingTags: string[] = [];

  const rendered = text.replace(MERGE_TAG_PATTERN, (_match, rawTag: string) => {
    const value = resolveTag(rawTag, lead);
    if (value === null || value === undefined || value === "") {
      missingTags.push(rawTag);
      return fallback;
    }
    return value;
  });

  return { text: rendered, missingTags };
}
