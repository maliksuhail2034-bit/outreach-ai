import { Node, mergeAttributes, nodeInputRule, nodePasteRule } from "@tiptap/core";

import { mergeTagChip } from "@/lib/email/merge-tag-options";

const CHIP_CLASS =
  "mx-0.5 inline-flex items-center rounded-md border px-1.5 align-baseline text-xs font-medium leading-5 select-none";
const SUPPORTED_CLASS = "border-primary/30 bg-primary/10 text-primary";
const UNSUPPORTED_CLASS = "border-destructive/40 bg-destructive/10 text-destructive";

// "{{ First Name }}" -> "First Name", the same tag the renderer captures.
function tagFromMatch(match: RegExpMatchArray) {
  return { tag: match[0].slice(2, -2).trim() };
}

// A merge variable as one atomic inline node: the cursor moves over it as a
// single position, Backspace/Delete remove it whole, and typing next to it
// can never edit or split the tag. It serializes back to {{tag}} (see
// lib/email/composer-markup.ts), the syntax stored in sequence_steps and
// resolved by the renderer.
export const MergeTagNode = Node.create({
  name: "mergeTag",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      tag: {
        default: "",
        parseHTML: (element) => (element.getAttribute("data-merge-tag") ?? "").replace(/[{}\r\n]/g, "").trim(),
        renderHTML: (attributes) => ({ "data-merge-tag": attributes.tag }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-merge-tag]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const tag = String(node.attrs.tag);
    const chip = mergeTagChip(tag);
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        contenteditable: "false",
        class: `${CHIP_CLASS} ${chip.supported ? SUPPORTED_CLASS : UNSUPPORTED_CLASS}`,
        title: chip.supported ? `{{${tag}}}` : `Unknown variable {{${tag}}} — it will be left blank`,
        "aria-label": chip.supported ? `Variable: ${chip.label}` : `Unknown variable: ${chip.label}`,
      }),
      chip.label,
    ];
  },

  // Copying a chip as plain text gives the tag syntax, so it pastes back as
  // a chip (see addPasteRules) or reads correctly anywhere else.
  renderText({ node }) {
    return `{{${String(node.attrs.tag)}}}`;
  },

  // Typing or pasting {{tag}} by hand produces the same chip the picker does.
  // No capture groups: nodeInputRule replaces only the last group when there
  // is one, which would leave the braces behind as text.
  addInputRules() {
    return [nodeInputRule({ find: /\{\{[^{}]+\}\}$/, type: this.type, getAttributes: tagFromMatch })];
  },

  addPasteRules() {
    return [nodePasteRule({ find: /\{\{[^{}]+\}\}/g, type: this.type, getAttributes: tagFromMatch })];
  },
});
