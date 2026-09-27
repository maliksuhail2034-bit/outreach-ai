import { Extension } from "@tiptap/core";
import Bold from "@tiptap/extension-bold";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import Italic from "@tiptap/extension-italic";
import Link from "@tiptap/extension-link";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import { Placeholder, UndoRedo } from "@tiptap/extensions";

import { isSafeLinkHref } from "@/lib/email/composer-markup";
import { MergeTagNode } from "./merge-tag-node";

// Only the formatting the stored markup can represent (see
// lib/email/composer-markup.ts) — anything else pasted in (headings, lists,
// images, other schemes' links) is dropped by the schema, not stored.
export function bodyExtensions(placeholder = "") {
  return [
    Document,
    Paragraph,
    Text,
    HardBreak,
    Bold,
    Italic,
    Link.configure({
      openOnClick: false,
      autolink: false,
      linkOnPaste: false,
      isAllowedUri: (url) => isSafeLinkHref(url),
    }),
    UndoRedo,
    Placeholder.configure({ placeholder }),
    MergeTagNode,
  ];
}

// The subject is one line of plain text with variable chips — no formatting,
// no line breaks.
const SingleLineDocument = Document.extend({ content: "paragraph" });

const SingleLineKeys = Extension.create({
  name: "singleLineKeys",
  addKeyboardShortcuts() {
    return { Enter: () => true, "Shift-Enter": () => true, "Mod-Enter": () => true };
  },
});

export function subjectExtensions(placeholder = "") {
  return [SingleLineDocument, Paragraph, Text, UndoRedo, Placeholder.configure({ placeholder }), SingleLineKeys, MergeTagNode];
}
