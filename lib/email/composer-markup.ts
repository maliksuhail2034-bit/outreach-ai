// The stored format of a sequence step body, and the conversions between it
// and the composer's editor document. Pure and DOM-free: the renderer
// (lib/email/render-email.ts), the editor (components/sequences/
// composer-editor.tsx) and the tests all share these functions.
//
// A body is still plain text (sequence_steps.body is a text column), with a
// deliberately small, conservative Markdown subset on top:
//   **bold**   *italic* or _italic_   [link text](https://…)
// plus the existing {{merge_tag}} syntax, blank-line paragraphs and single
// line breaks. Plain text with none of that syntax parses to itself, so
// every body written before the rich-text composer renders unchanged.
//
// Parsing always happens on the template, before any lead data is merged in
// — a lead value is only ever substituted into an already-parsed text slot,
// so a company named "**Acme**" or "[x](https://evil)" can never become
// formatting or a link.
import { mergeTagSyntax } from "./merge-tag-options";
import { MERGE_TAG_PATTERN } from "./merge-tags";

export type ComposerInline =
  | { type: "text"; text: string }
  | { type: "tag"; tag: string }
  | { type: "bold"; children: ComposerInline[] }
  | { type: "italic"; children: ComposerInline[] }
  | { type: "link"; href: string; children: ComposerInline[] };

// Structurally compatible with Tiptap's JSONContent, without importing the
// editor into server code.
export interface ComposerJsonMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface ComposerJsonNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: ComposerJsonNode[];
  marks?: ComposerJsonMark[];
  text?: string;
}

// A link target as written in a template: an http(s) URL — an allowlist, so
// no other scheme (javascript:, data:, vbscript:, …) can ever become a link
// — which may carry merge tags (https://acme.com/?ref={{email}}), or exactly
// one merge tag standing for a whole URL ({{unsubscribe_link}}). The
// renderer checks the merged result again with isHttpUrl.
const LINK_HREF_SOURCE = String.raw`(?:https?:\/\/[^\s()<>"]+|\{\{[^{}\n]+\}\})`;
const LINK_HREF_PATTERN = new RegExp(`^${LINK_HREF_SOURCE}$`, "i");
const LINK_HREF_PREFIX_PATTERN = new RegExp(`^${LINK_HREF_SOURCE}`, "i");
const HTTP_URL_PATTERN = /^https?:\/\/[^\s<>"]+$/i;

export function isSafeLinkHref(href: string): boolean {
  return LINK_HREF_PATTERN.test(href);
}

export function isHttpUrl(url: string): boolean {
  return HTTP_URL_PATTERN.test(url);
}

// Bare URLs are opaque to formatting (a "*" or "_" inside a URL is never a
// delimiter) so existing bodies with URLs keep rendering exactly as before.
// Trailing "*"/"_" are left outside the URL so **https://acme.com** still
// closes its bold.
const URL_SCHEME_PATTERN = /https?:\/\//iy;
const URL_END_PATTERN = /[\s<\\]/;
const TAG_PATTERN = new RegExp(MERGE_TAG_PATTERN.source, "y");
const WORD_CHAR_PATTERN = /[\p{L}\p{N}]/u;
const WHITESPACE_PATTERN = /\s/;

const ESCAPABLE = new Set(["\\", "*", "_", "[", "]"]);

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && WORD_CHAR_PATTERN.test(char);
}

function isWhitespace(char: string | undefined): boolean {
  return char === undefined || WHITESPACE_PATTERN.test(char);
}

function matchTagAt(source: string, index: number): RegExpExecArray | null {
  if (source[index] !== "{" || source[index + 1] !== "{") return null;
  TAG_PATTERN.lastIndex = index;
  return TAG_PATTERN.exec(source);
}

// A merge tag inside a URL is part of it, even one with spaces
// (https://acme.com/{{ First Name }}) — the old renderer merged before
// linkifying, so the whole thing was one URL.
function bareUrlLengthAt(source: string, index: number): number {
  if (source[index] !== "h" && source[index] !== "H") return 0;
  if (isWordChar(source[index - 1]) || source[index - 1] === "_") return 0;
  URL_SCHEME_PATTERN.lastIndex = index;
  const scheme = URL_SCHEME_PATTERN.exec(source);
  if (!scheme) return 0;

  let end = index + scheme[0].length;
  while (end < source.length) {
    const tag = matchTagAt(source, end);
    if (tag) end += tag[0].length;
    else if (URL_END_PATTERN.test(source[end])) break;
    else end++;
  }
  if (end === index + scheme[0].length) return 0;
  while (end > index && (source[end - 1] === "*" || source[end - 1] === "_")) end--;
  return end - index;
}

function delimiterRunLength(source: string, index: number): number {
  const char = source[index];
  let end = index;
  while (source[end] === char) end++;
  return end - index;
}

// Length of an indivisible unit at `index` (an escape, a merge tag, a bare
// URL) that a delimiter search must step over whole, or 0.
function atomLengthAt(source: string, index: number): number {
  if (source[index] === "\\" && ESCAPABLE.has(source[index + 1])) return 2;
  const tag = matchTagAt(source, index);
  if (tag) return tag[0].length;
  return bareUrlLengthAt(source, index);
}

// Index of the delimiter run closing an emphasis opened at `start`, or -1
// with `end` set to where the search stopped (the end of the line).
// Emphasis never spans a line, and a closing run must be exactly as long
// as the opening one.
function findClosingDelimiter(
  source: string,
  start: number,
  char: string,
  length: number,
): { close: number; end: number } {
  let index = start;
  while (index < source.length && source[index] !== "\n") {
    const atom = atomLengthAt(source, index);
    if (atom > 0) {
      index += atom;
      continue;
    }
    if (source[index] === char) {
      const run = delimiterRunLength(source, index);
      if (
        run === length &&
        index > start &&
        !isWhitespace(source[index - 1]) &&
        (char !== "_" || !isWordChar(source[index + run]))
      ) {
        return { close: index, end: index };
      }
      index += run;
      continue;
    }
    index++;
  }
  return { close: -1, end: index };
}

// Deeper than anything the composer writes (link > bold > italic); past it
// delimiters are literal text, which keeps parsing linear on crafted input.
const MAX_NESTING = 8;

// [text](href) on one line, or null.
function matchLinkAt(source: string, index: number): { text: string; href: string; length: number } | null {
  let close = index + 1;
  while (close < source.length && source[close] !== "]") {
    if (source[close] === "\n" || source[close] === "[") return null;
    if (source[close] === "\\" && ESCAPABLE.has(source[close + 1])) close += 2;
    else close += matchTagAt(source, close)?.[0].length ?? 1;
  }
  if (source[close] !== "]" || source[close + 1] !== "(" || close === index + 1) return null;

  const href = LINK_HREF_PREFIX_PATTERN.exec(source.slice(close + 2));
  if (!href || source[close + 2 + href[0].length] !== ")") return null;

  return {
    text: source.slice(index + 1, close),
    href: href[0],
    length: close + 2 + href[0].length + 1 - index,
  };
}

function pushText(nodes: ComposerInline[], text: string) {
  if (!text) return;
  const last = nodes[nodes.length - 1];
  if (last?.type === "text") last.text += text;
  else nodes.push({ type: "text", text });
}

function parseInline(source: string, allowLinks: boolean, depth = 0): ComposerInline[] {
  const nodes: ComposerInline[] = [];
  let index = 0;
  // Per delimiter kind: a search that found no closing run from `from` to
  // the end of its line (`end`). A later opener of the same kind on that
  // line can only look at a subset of what was already searched, so it is
  // literal without searching again — otherwise a line of many unclosed
  // delimiters is quadratic.
  const noCloser = new Map<string, { from: number; end: number }>();

  while (index < source.length) {
    const char = source[index];

    if (char === "\\" && ESCAPABLE.has(source[index + 1])) {
      pushText(nodes, source[index + 1]);
      index += 2;
      continue;
    }

    const tag = matchTagAt(source, index);
    if (tag) {
      nodes.push({ type: "tag", tag: tag[1] });
      index += tag[0].length;
      continue;
    }

    const urlLength = bareUrlLengthAt(source, index);
    if (urlLength > 0) {
      // Literal text apart from any merge tags inside it (a URL like
      // https://acme.com/?ref={{email}} still resolves the tag).
      for (const node of parseTagsOnly(source.slice(index, index + urlLength))) {
        if (node.type === "text") pushText(nodes, node.text);
        else nodes.push(node);
      }
      index += urlLength;
      continue;
    }

    if (char === "[" && allowLinks) {
      const link = matchLinkAt(source, index);
      if (link) {
        nodes.push({ type: "link", href: link.href, children: parseInline(link.text, false, depth + 1) });
        index += link.length;
        continue;
      }
    }

    if (char === "*" || char === "_") {
      const run = delimiterRunLength(source, index);
      const start = index + run;
      const key = `${char}${run}`;
      const blocked = noCloser.get(key);
      const opens =
        depth < MAX_NESTING &&
        (char === "*" ? run <= 3 : run === 1) &&
        !isWhitespace(source[start]) &&
        (char !== "_" || !isWordChar(source[index - 1])) &&
        !(blocked && start >= blocked.from && start <= blocked.end);
      let close = -1;
      if (opens) {
        const result = findClosingDelimiter(source, start, char, run);
        close = result.close;
        if (close === -1) noCloser.set(key, { from: start, end: result.end });
      }
      if (close !== -1) {
        const children = parseInline(source.slice(start, close), allowLinks, depth + 1);
        if (run === 1) nodes.push({ type: "italic", children });
        else if (run === 2) nodes.push({ type: "bold", children });
        else nodes.push({ type: "bold", children: [{ type: "italic", children }] });
        index = close + run;
        continue;
      }
      pushText(nodes, source.slice(index, index + run));
      index += run;
      continue;
    }

    pushText(nodes, char);
    index++;
  }

  return nodes;
}

function parseTagsOnly(source: string): ComposerInline[] {
  const nodes: ComposerInline[] = [];
  let index = 0;
  while (index < source.length) {
    const tag = matchTagAt(source, index);
    if (tag) {
      nodes.push({ type: "tag", tag: tag[1] });
      index += tag[0].length;
    } else {
      pushText(nodes, source[index]);
      index++;
    }
  }
  return nodes;
}

export function parseComposerMarkup(markup: string): ComposerInline[] {
  return parseInline(markup, true);
}

// Readable text with formatting removed and merge tags left as {{tag}} —
// for summaries of a step's body in lists, never for sending.
export function composerMarkupToPlainText(markup: string): string {
  const walk = (nodes: ComposerInline[]): string =>
    nodes
      .map((node) => {
        if (node.type === "text") return node.text;
        if (node.type === "tag") return mergeTagSyntax(node.tag);
        return walk(node.children);
      })
      .join("");
  return walk(parseComposerMarkup(markup));
}

// ---------------------------------------------------------------------------
// Stored markup -> editor document

interface FlatInline {
  node: { type: "text"; text: string } | { type: "tag"; tag: string };
  marks: ComposerJsonMark[];
}

function flatten(nodes: ComposerInline[], marks: ComposerJsonMark[], out: FlatInline[]) {
  for (const node of nodes) {
    if (node.type === "text" || node.type === "tag") out.push({ node, marks });
    else if (node.type === "bold") flatten(node.children, [...marks, { type: "bold" }], out);
    else if (node.type === "italic") flatten(node.children, [...marks, { type: "italic" }], out);
    else flatten(node.children, [...marks, { type: "link", attrs: { href: node.href } }], out);
  }
}

function withMarks(node: ComposerJsonNode, marks: ComposerJsonMark[]): ComposerJsonNode {
  return marks.length > 0 ? { ...node, marks } : node;
}

export function bodyMarkupToDoc(markup: string): ComposerJsonNode {
  const flat: FlatInline[] = [];
  flatten(parseComposerMarkup(markup.replace(/\r\n/g, "\n")), [], flat);

  const paragraphs: ComposerJsonNode[][] = [[]];
  for (const { node, marks } of flat) {
    const current = () => paragraphs[paragraphs.length - 1];
    if (node.type === "tag") {
      current().push(withMarks({ type: "mergeTag", attrs: { tag: node.tag } }, marks));
      continue;
    }
    // Same paragraph rule as the renderer: a blank line starts a new
    // paragraph, a single newline is a line break.
    for (const piece of node.text.split(/(\n+)/)) {
      if (!piece) continue;
      if (piece === "\n") current().push({ type: "hardBreak" });
      else if (piece.startsWith("\n")) paragraphs.push([]);
      else current().push(withMarks({ type: "text", text: piece }, marks));
    }
  }

  return {
    type: "doc",
    content: paragraphs.map((content) => (content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" })),
  };
}

export function subjectTextToDoc(subject: string): ComposerJsonNode {
  const content = parseTagsOnly(subject.replace(/[\r\n]+/g, " ")).map(
    (node): ComposerJsonNode =>
      node.type === "tag" ? { type: "mergeTag", attrs: { tag: node.tag } } : { type: "text", text: node.type === "text" ? node.text : "" },
  );
  return { type: "doc", content: [content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" }] };
}

// ---------------------------------------------------------------------------
// Editor document -> stored markup

// A chip's tag attribute can arrive from pasted HTML; braces would break the
// {{…}} it serializes to.
function normalizeTag(tag: unknown): string {
  return typeof tag === "string" ? tag.replace(/[{}\r\n]/g, "").trim() : "";
}

function serializeTag(tag: unknown): string {
  const normalized = normalizeTag(tag);
  return normalized ? mergeTagSyntax(normalized) : "";
}

// Escapes only what the parser would otherwise read as syntax. Bare URLs
// are left untouched (the parser treats them as opaque), and "_" only
// where it could open or close emphasis, so snake_case and ordinary
// punctuation are stored as typed.
export function escapeComposerText(text: string): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const urlLength = bareUrlLengthAt(text, index);
    if (urlLength > 0) {
      out += text.slice(index, index + urlLength);
      index += urlLength;
      continue;
    }
    const char = text[index];
    if (char === "*" || char === "[" || char === "]") out += `\\${char}`;
    else if (char === "_") out += isWordChar(text[index - 1]) && isWordChar(text[index + 1]) ? "_" : "\\_";
    else if (char === "\\") out += index === text.length - 1 || ESCAPABLE.has(text[index + 1]) ? "\\\\" : "\\";
    else out += char;
    index++;
  }
  return out;
}

interface SerialItem {
  kind: "text" | "tag";
  value: string;
  bold: boolean;
  italic: boolean;
  href: string | null;
}

function toSerialItem(node: ComposerJsonNode): SerialItem | null {
  const marks = node.marks ?? [];
  const link = marks.find((mark) => mark.type === "link");
  const href = typeof link?.attrs?.href === "string" && isSafeLinkHref(link.attrs.href) ? link.attrs.href : null;
  const base = { bold: marks.some((m) => m.type === "bold"), italic: marks.some((m) => m.type === "italic"), href };
  if (node.type === "text" && node.text) return { kind: "text", value: node.text, ...base };
  if (node.type === "mergeTag") {
    const tag = serializeTag(node.attrs?.tag);
    return tag ? { kind: "tag", value: tag, ...base } : null;
  }
  return null;
}

function groupBy<T>(items: T[], key: (item: T) => unknown): T[][] {
  const groups: T[][] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && key(last[0]) === key(item)) last.push(item);
    else groups.push([item]);
  }
  return groups;
}

// Emphasis delimiters must hug non-whitespace, so surrounding spaces move
// outside them.
function wrap(delimiter: string, inner: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  if (!match || !match[2]) return inner;
  return `${match[1]}${delimiter}${match[2]}${delimiter}${match[3]}`;
}

function serializePlain(items: SerialItem[]): string {
  return items.map((item) => (item.kind === "tag" ? item.value : escapeComposerText(item.value))).join("");
}

// Italic is written as _x_ so it can never merge with a neighbouring ** into
// an ambiguous *** run — except inside a word, where "_" can't open or close
// emphasis and "*" has to be used instead.
function serializeItalicGroups(items: SerialItem[]): string {
  const groups = groupBy(items, (item) => item.italic);
  return groups
    .map((group, index) => {
      const inner = serializePlain(group);
      if (!group[0].italic) return inner;
      const before = groups[index - 1]?.at(-1)?.value.at(-1);
      const after = groups[index + 1]?.[0]?.value[0];
      return wrap(isWordChar(before) || isWordChar(after) ? "*" : "_", inner);
    })
    .join("");
}

function serializeBoldGroups(items: SerialItem[]): string {
  return groupBy(items, (item) => item.bold)
    .map((group) => (group[0].bold ? wrap("**", serializeItalicGroups(group)) : serializeItalicGroups(group)))
    .join("");
}

function serializeItems(items: SerialItem[]): string {
  return groupBy(items, (item) => item.href)
    .map((group) => {
      const inner = serializeBoldGroups(group);
      return group[0].href && inner.trim() ? `[${inner}](${group[0].href})` : inner;
    })
    .join("");
}

function itemKey(item: SerialItem): string {
  return JSON.stringify([item.kind === "tag", item.bold, item.italic, item.href]);
}

// Adjacent pieces with identical marks merged, so two spellings of the same
// formatted line compare equal.
function normalizeItems(items: SerialItem[]): string {
  return JSON.stringify(
    groupBy(items, (item) => (item.kind === "tag" ? Symbol() : itemKey(item))).map((group) => [
      itemKey(group[0]),
      group.map((item) => item.value).join(""),
    ]),
  );
}

function parsedItems(markup: string): SerialItem[] {
  const flat: FlatInline[] = [];
  flatten(parseComposerMarkup(markup), [], flat);
  return flat.map(({ node, marks }) => {
    const link = marks.find((mark) => mark.type === "link");
    return {
      kind: node.type,
      value: node.type === "tag" ? mergeTagSyntax(node.tag) : node.text,
      bold: marks.some((mark) => mark.type === "bold"),
      italic: marks.some((mark) => mark.type === "italic"),
      href: typeof link?.attrs?.href === "string" ? link.attrs.href : null,
    };
  });
}

// Italic that starts or ends inside a word, next to a bold edge
// (**a*b***), has no unambiguous spelling in this syntax. Rather than save
// something that reloads as literal asterisks, those italics are dropped;
// every other mark on the line is kept.
function withoutIntrawordItalics(items: SerialItem[]): SerialItem[] {
  const result = items.map((item) => ({ ...item }));
  let start = 0;
  while (start < result.length) {
    if (!result[start].italic) {
      start++;
      continue;
    }
    let end = start;
    while (end + 1 < result.length && result[end + 1].italic) end++;
    const before = result[start - 1]?.value.at(-1);
    const after = result[end + 1]?.value[0];
    if (isWordChar(before) || isWordChar(after)) {
      for (let index = start; index <= end; index++) result[index].italic = false;
    }
    start = end + 1;
  }
  return result;
}

function serializeLine(nodes: ComposerJsonNode[]): string {
  const items = nodes.map(toSerialItem).filter((item): item is SerialItem => item !== null);
  const markup = serializeItems(items);
  if (normalizeItems(parsedItems(markup)) === normalizeItems(items)) return markup;
  return serializeItems(withoutIntrawordItalics(items));
}

function serializeParagraph(paragraph: ComposerJsonNode): string {
  const lines: ComposerJsonNode[][] = [[]];
  for (const node of paragraph.content ?? []) {
    if (node.type === "hardBreak") lines.push([]);
    else lines[lines.length - 1].push(node);
  }
  return lines.map(serializeLine).join("\n");
}

export function docToBodyMarkup(doc: ComposerJsonNode): string {
  return (doc.content ?? []).map(serializeParagraph).join("\n\n").trim();
}

// The subject stays plain text: chips become {{tag}}, formatting (none is
// offered) is ignored, and paragraphs from a multi-line paste join with a
// space.
export function docToSubjectText(doc: ComposerJsonNode): string {
  return (doc.content ?? [])
    .map((paragraph) =>
      (paragraph.content ?? [])
        .map((node) => {
          if (node.type === "text") return node.text ?? "";
          if (node.type === "mergeTag") return serializeTag(node.attrs?.tag);
          if (node.type === "hardBreak") return " ";
          return "";
        })
        .join(""),
    )
    .join(" ")
    .trim();
}
