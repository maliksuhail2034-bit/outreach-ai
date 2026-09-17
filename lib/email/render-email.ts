// Canonical email rendering path: the one place a sequence step's plain-text
// subject/body template, plus a lead, turns into what actually gets sent —
// an HTML body and a plain-text body, both merge-tag-substituted, both
// safely escaped. lib/email/send-worker.ts is the only production caller
// today; any future preview feature and every rendering test should also go
// through renderEmailContent so there is exactly one definition of what a
// rendered email looks like.
//
// Why whole-body escaping instead of merge-tags.ts's per-substitution
// escapeHtml option: that option escapes only the *substituted value*,
// leaving the surrounding template text untouched — correct if the template
// is itself pre-authored HTML, but the campaign composer
// (components/sequences/sequence-step-form.tsx) is a plain <Textarea>. The
// template is plain text end to end, so the whole merged string — the
// user's own typed text and every substituted lead field alike — needs
// escaping, not just the substitutions. Rendering here merges first with
// escapeHtml: false (producing the plain-text output as a side effect, for
// free) and then HTML-escapes the single merged string once.
import { escapeHtml, renderMergeTags, type MergeTagLead } from "./merge-tags";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  // Union of missing/unsupported tags across both subject and body, tag text
  // deduplicated — see merge-tags.ts's RenderMergeTagsResult for what each
  // means. Callers that want to warn/log do so themselves; this module never
  // touches logging or storage.
  missingTags: string[];
  unsupportedTags: string[];
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

// Matches only an explicit http(s) scheme — deliberately an allowlist
// rather than a denylist of dangerous schemes (javascript:, data:, vbscript:,
// etc.): text that isn't recognized here is left exactly as the escaped
// plain text it already was, never turned into a link, so there is no
// scheme this could ever turn into a clickable, script-capable URL. Runs
// against the already-HTML-escaped paragraph text (see plainTextToHtml), so
// a literal "&" inside a matched URL is already "&amp;" — correct both as
// the href attribute value and as the visible link text.
const SAFE_URL_PATTERN = /\bhttps?:\/\/[^\s<]+/gi;

// Sentence punctuation immediately after a URL ("...at https://acme.com.")
// almost never belongs to the URL itself — trimmed off the link and placed
// back outside the closing </a> instead.
const TRAILING_PUNCTUATION_PATTERN = /[.,!?;:)\]]+$/;

// Turns bare http(s) URLs in already-escaped text into real anchors. Must
// run after escapeHtml (see plainTextToHtml) — operating on raw
// user/lead text would let an "&" inside a URL's query string reach the
// href attribute unescaped.
function linkifyEscapedText(escapedText: string): string {
  return escapedText.replace(SAFE_URL_PATTERN, (match) => {
    let url = match;
    let trailing = "";
    const trailingMatch = url.match(TRAILING_PUNCTUATION_PATTERN);
    if (trailingMatch) {
      trailing = trailingMatch[0];
      url = url.slice(0, -trailing.length);
    }
    if (!url) return match;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${trailing}`;
  });
}

// Turns already merge-tag-rendered plain text (with the sender's original
// line breaks) into safe HTML: blank-line-separated blocks become
// paragraphs, a single line break within a block becomes <br>, bare http(s)
// URLs become clickable links, and every character is HTML-escaped first so
// nothing in the source text — sender-typed or substituted from lead data —
// can be interpreted as markup.
export function plainTextToHtml(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${linkifyEscapedText(escapeHtml(paragraph)).split("\n").join("<br>\n")}</p>`)
    .join("\n");
}

// Renders one sequence step's subject/body templates for one lead. Pure and
// DB-free, like merge-tags.ts — no provider calls, no unsubscribe-footer
// logic (that stays in send-worker.ts, since it depends on org settings and
// whether the template already included the link).
export function renderEmailContent(
  subjectTemplate: string,
  bodyTemplate: string,
  lead: MergeTagLead,
): RenderedEmail {
  const subjectResult = renderMergeTags(subjectTemplate, lead);
  const bodyResult = renderMergeTags(bodyTemplate, lead, { escapeHtml: false });

  return {
    subject: subjectResult.text,
    text: bodyResult.text,
    html: plainTextToHtml(bodyResult.text),
    missingTags: dedupe([...subjectResult.missingTags, ...bodyResult.missingTags]),
    unsupportedTags: dedupe([...subjectResult.unsupportedTags, ...bodyResult.unsupportedTags]),
  };
}
