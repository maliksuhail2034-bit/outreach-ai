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
  // Precomputed by the caller (lib/email/send-worker.ts, via
  // lib/email/unsubscribe-token.ts) — this module stays free of token
  // signing/DB access, same reasoning as every other field here.
  unsubscribeUrl?: string | null;
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
  unsubscribe_link: (lead) => lead.unsubscribeUrl,
};

export const SUPPORTED_MERGE_TAGS = Object.keys(MERGE_TAG_RESOLVERS);

// User-facing spellings that don't match a canonical key verbatim but should
// still resolve — e.g. a lead export or a user typing what they see in the
// UI copy ("Company Name") rather than the backend's internal name
// ("company"). Keyed by the tag after normalizeAlias() below (lowercased,
// interior whitespace collapsed to "_"); most variants ("First Name" ->
// "first_name", "Email" -> "email") already land on a real resolver key
// without needing an entry here — this map only carries the cases where the
// normalized spelling still doesn't match the canonical name.
const MERGE_TAG_ALIASES: Record<string, string> = {
  company_name: "company",
};

// Anything but literal braces, trimmed of surrounding whitespace by the
// \s* outside the capture group — deliberately permissive (unlike the old
// [a-zA-Z0-9_.]+ charset) so user-facing variants with spaces, e.g.
// {{First Name}} or {{Company Name}}, are captured at all. Whether a
// captured tag actually resolves is decided by resolveTag below, not by
// this pattern.
const MERGE_TAG_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

function getByPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

// Maps a raw tag as typed (e.g. "First Name", "  Email ") onto a canonical
// resolver key, or null if it doesn't match any known tag/alias. Only used
// as a fallback after an exact match fails, so it never changes the
// case-sensitive behavior of an exact canonical tag or a custom_fields.*
// path (see resolveTag).
function normalizeAlias(tag: string): string | null {
  const key = tag.trim().toLowerCase().replace(/\s+/g, "_");
  if (key in MERGE_TAG_RESOLVERS) return key;
  if (key in MERGE_TAG_ALIASES) return MERGE_TAG_ALIASES[key];
  return null;
}

interface TagResolution {
  value: string | null | undefined;
  // false means the tag name itself isn't recognized as any built-in tag,
  // alias, or custom_fields.* path — distinct from a recognized tag that
  // simply has no value for this lead (see missingTags vs. unsupportedTags
  // on RenderMergeTagsResult below).
  supported: boolean;
}

// custom_fields is arbitrary per-lead enrichment data (see
// supabase/migrations/20260728100050_leads.sql) — {{custom_fields.role}}
// resolves without needing a resolver entry above, so a fully custom merge
// tag never requires a code change at all, not even here.
function resolveTag(tag: string, lead: MergeTagLead): TagResolution {
  const resolver = MERGE_TAG_RESOLVERS[tag];
  if (resolver) return { value: resolver(lead), supported: true };

  if (tag.startsWith("custom_fields.")) {
    const path = tag.split(".").slice(1);
    const value = getByPath(lead.custom_fields ?? {}, path);
    if (value === null || value === undefined) return { value: null, supported: true };
    return { value: typeof value === "string" ? value : String(value), supported: true };
  }

  const aliasKey = normalizeAlias(tag);
  if (aliasKey) return { value: MERGE_TAG_RESOLVERS[aliasKey](lead), supported: true };

  return { value: undefined, supported: false };
}

// Phase 3B Enterprise Readiness (security audit, item 2): lead data (company,
// title, custom_fields) is free text with no HTML sanitization at the
// validation boundary (lib/validations/leads.ts) — a crafted field value
// interpolated unescaped into an outbound HTML email would be live markup in
// a real message riding on the sending org's own domain. Only the
// interpolated value gets escaped, never the surrounding template text, so
// an org's own intentionally-authored HTML in their step body is untouched.
const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

// Exported for lib/email/render-email.ts, which escapes a whole rendered
// body (template text and substituted values alike) in one pass rather than
// per-substitution — see that module for why. Same escaping rules either
// way, one definition.
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

// Inverse of escapeHtml, exported for lib/email/send-worker.ts's
// click-tracking link rewriter (Batch 9B): a URL captured out of an
// already-escaped href="..." attribute (see render-email.ts's
// linkifyEscapedText) still has entities like "&amp;" in place of the
// original "&" — that's correct HTML, but wrong the moment it's used as a
// literal HTTP redirect target or signed into a token, neither of which
// HTML-decodes anything. "&amp;" is decoded last, deliberately, so a
// literal "&lt;" in the source (itself encoded as "&amp;lt;") round-trips
// back to "&lt;" instead of being double-decoded into "<".
const HTML_UNESCAPE_ORDER: [RegExp, string][] = [
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  [/&amp;/g, "&"],
];

export function unescapeHtml(value: string): string {
  return HTML_UNESCAPE_ORDER.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), value);
}

export interface RenderMergeTagsResult {
  text: string;
  // Every tag that didn't produce a non-empty value — both "recognized tag,
  // no data for this lead" and "not a recognized tag at all". Kept as the
  // superset for callers that only care that *something* didn't resolve.
  missingTags: string[];
  // Subset of missingTags: tags whose name isn't a known built-in tag,
  // alias, or custom_fields.* path. Separated out so a caller can log/flag
  // "someone typo'd a merge tag" distinctly from "this lead just has no
  // company on file".
  unsupportedTags: string[];
}

// Replaces every {{tag}} occurrence in `text`. Unknown tags and tags that
// resolve to null/undefined/empty never throw — they fall back to
// `options.fallback` (default: empty string) and are reported in
// missingTags so a caller can log the gap without this module touching any
// storage itself.
//
// `escapeHtml` defaults to false — a sequence step's subject is plain text,
// shown verbatim in a mail client's Subject header (escaping it would
// literally show "&amp;" to the recipient), so no caller should ever pass
// escapeHtml: true for a subject. Body HTML rendering does not use this
// option — see lib/email/render-email.ts, the canonical body renderer, which
// escapes the whole merged body in one pass instead (see its module comment
// for why per-substitution escaping isn't enough once the body itself is
// plain text rather than pre-authored HTML).
export function renderMergeTags(
  text: string,
  lead: MergeTagLead,
  options?: { fallback?: string; escapeHtml?: boolean },
): RenderMergeTagsResult {
  const fallback = options?.fallback ?? "";
  const shouldEscape = options?.escapeHtml ?? false;
  const missingTags: string[] = [];
  const unsupportedTags: string[] = [];

  const rendered = text.replace(MERGE_TAG_PATTERN, (_match, rawTag: string) => {
    const resolution = resolveTag(rawTag, lead);
    if (!resolution.supported) {
      missingTags.push(rawTag);
      unsupportedTags.push(rawTag);
      return fallback;
    }
    const { value } = resolution;
    if (value === null || value === undefined || value === "") {
      missingTags.push(rawTag);
      return fallback;
    }
    return shouldEscape ? escapeHtml(value) : value;
  });

  return { text: rendered, missingTags, unsupportedTags };
}
