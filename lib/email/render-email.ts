// Canonical email rendering path: the one place a sequence step's subject/
// body template, plus a lead, turns into what actually gets sent — an HTML
// body and a plain-text body, both merge-tag-substituted, both safely
// escaped. lib/email/send-worker.ts, the composer's preview
// (components/sequences/email-preview-dialog.tsx) and template validation
// (lib/email/validate-template.ts) all go through renderEmailContent, so
// there is exactly one definition of what a rendered email looks like.
//
// The body is plain text plus a small formatting subset (see
// lib/email/composer-markup.ts). Order matters for safety: the template is
// parsed into formatting first, then each merge tag is resolved into its
// already-parsed slot, then every piece of text — the sender's own and each
// lead value alike — is HTML-escaped as it's emitted. A lead value is never
// parsed as formatting and never emitted as markup.
import { isHttpUrl, parseComposerMarkup, type ComposerInline } from "./composer-markup";
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
// against already-HTML-escaped text, so a literal "&" inside a matched URL
// is already "&amp;" — correct both as the href attribute value and as the
// visible link text.
const SAFE_URL_PATTERN = /\bhttps?:\/\/[^\s<]+/gi;

// Sentence punctuation immediately after a URL ("...at https://acme.com.")
// almost never belongs to the URL itself — trimmed off the link and placed
// back outside the closing </a> instead.
const TRAILING_PUNCTUATION_PATTERN = /[.,!?;:)\]]+$/;

// Turns bare http(s) URLs in already-escaped text into real anchors. Must
// run after escapeHtml — operating on raw user/lead text would let an "&"
// inside a URL's query string reach the href attribute unescaped.
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
    return `${anchorOpen(url)}${url}</a>${trailing}`;
  });
}

// Every anchor this module emits has this exact shape — the send worker's
// click-tracking rewriter (rewriteClickTrackingLinks) matches on it.
function anchorOpen(escapedHref: string): string {
  return `<a href="${escapedHref}" target="_blank" rel="noopener noreferrer">`;
}

// Blank-line-separated blocks become paragraphs and a single line break
// becomes <br>. Newlines only ever come from text runs (formatting never
// spans a line), so splitting the finished inline HTML never cuts through a
// tag.
function wrapParagraphs(inlineHtml: string): string {
  const normalized = inlineHtml.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";
  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.split("\n").join("<br>\n")}</p>`)
    .join("\n");
}

const SINGLE_TAG_HREF_PATTERN = /^\{\{\s*([^{}]+?)\s*\}\}$/;
const TAG_IN_HREF_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

interface RenderedInline {
  html: string;
  text: string;
}

function renderBody(bodyTemplate: string, lead: MergeTagLead) {
  const missingTags: string[] = [];
  const unsupportedTags: string[] = [];

  // Same resolution, fallback and reporting as a plain merge — each tag is
  // resolved through renderMergeTags, one tag at a time.
  function resolveTag(tag: string): string {
    const result = renderMergeTags(`{{${tag}}}`, lead);
    missingTags.push(...result.missingTags);
    unsupportedTags.push(...result.unsupportedTags);
    return result.text;
  }

  // An href that is exactly one merge tag ({{unsubscribe_link}}, a
  // custom_fields URL) takes the value as-is; a tag embedded in a URL is
  // percent-encoded. Either way the result must still be an http(s) URL,
  // or the link text is emitted without a link.
  function resolveHref(hrefTemplate: string): string | null {
    const single = SINGLE_TAG_HREF_PATTERN.exec(hrefTemplate);
    const href = single
      ? resolveTag(single[1]).trim()
      : hrefTemplate.replace(TAG_IN_HREF_PATTERN, (_match, tag: string) => encodeURIComponent(resolveTag(tag)));
    return isHttpUrl(href) ? href : null;
  }

  // Walks the parsed template once, producing HTML and plain text together.
  // Consecutive text and merge values are escaped and linkified as one run,
  // exactly as a plain-text body always was — a bare URL assembled from
  // template text plus a lead value still becomes one link.
  function render(nodes: ComposerInline[], context: { formatted: boolean; inLink: boolean }): RenderedInline {
    let html = "";
    let text = "";
    let run = "";

    const flush = () => {
      if (!run) return;
      const escaped = escapeHtml(run);
      html += context.inLink ? escaped : linkifyEscapedText(escaped);
      run = "";
    };

    for (const node of nodes) {
      if (node.type === "text" || node.type === "tag") {
        let value = node.type === "text" ? node.text : resolveTag(node.tag);
        // A line break inside formatting would split its tags across
        // paragraphs; lead values there are kept on one line.
        if (context.formatted) value = value.replace(/(\r?\n)+/g, " ");
        run += value;
        text += value;
        continue;
      }

      flush();
      if (node.type === "bold" || node.type === "italic") {
        const inner = render(node.children, { ...context, formatted: true });
        const element = node.type === "bold" ? "strong" : "em";
        html += `<${element}>${inner.html}</${element}>`;
        text += inner.text;
        continue;
      }

      const inner = render(node.children, { formatted: true, inLink: true });
      const href = resolveHref(node.href);
      if (!href) {
        html += inner.html;
        text += inner.text;
        continue;
      }
      html += `${anchorOpen(escapeHtml(href))}${inner.html}</a>`;
      const label = inner.text.trim();
      text += !label || label === href ? href : `${inner.text} (${href})`;
    }

    flush();
    return { html, text };
  }

  const rendered = render(parseComposerMarkup(bodyTemplate), { formatted: false, inLink: false });
  return { html: wrapParagraphs(rendered.html), text: rendered.text, missingTags, unsupportedTags };
}

// Renders one sequence step's subject/body templates for one lead. Pure and
// DB-free, like merge-tags.ts — no provider calls, no unsubscribe-footer
// logic (that stays in send-worker.ts, since it depends on org settings and
// whether the template already included the link). The subject is plain
// text (shown verbatim in the Subject header), so it is merged, never
// parsed for formatting or escaped.
export function renderEmailContent(
  subjectTemplate: string,
  bodyTemplate: string,
  lead: MergeTagLead,
): RenderedEmail {
  const subjectResult = renderMergeTags(subjectTemplate, lead);
  const body = renderBody(bodyTemplate, lead);

  return {
    subject: subjectResult.text,
    text: body.text,
    html: body.html,
    missingTags: dedupe([...subjectResult.missingTags, ...body.missingTags]),
    unsupportedTags: dedupe([...subjectResult.unsupportedTags, ...body.unsupportedTags]),
  };
}
