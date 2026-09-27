// @vitest-environment jsdom
//
// The composer's editing behavior needs a real DOM (ProseMirror), so this
// file alone runs under jsdom; the rest of the suite stays on node.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor, type JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";

import { bodyMarkupToDoc, docToBodyMarkup, docToSubjectText, subjectTextToDoc } from "@/lib/email/composer-markup";
import { bodyExtensions, subjectExtensions } from "./editor/composer-extensions";
import { ComposerEditor, type ComposerEditorHandle } from "./composer-editor";

// jsdom has no layout or clipboard: ProseMirror asks for client rects when
// scrolling the selection into view, and Tiptap's paste rules build a
// ClipboardEvent around a DataTransfer.
beforeAll(() => {
  const noRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList;
  const emptyRect = () => new DOMRect();
  Element.prototype.getClientRects = noRects;
  Range.prototype.getClientRects = noRects;
  Range.prototype.getBoundingClientRect = emptyRect;
  vi.stubGlobal(
    "DataTransfer",
    class {
      getData() {
        return "";
      }
      setData() {}
    },
  );
  vi.stubGlobal(
    "ClipboardEvent",
    class extends Event {
      clipboardData = null;
    },
  );
});

const editors: Editor[] = [];

function bodyEditor(markup = "") {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: bodyExtensions(),
    content: bodyMarkupToDoc(markup) as JSONContent,
  });
  editors.push(editor);
  return editor;
}

function subjectEditor(text = "") {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: subjectExtensions(),
    content: subjectTextToDoc(text) as JSONContent,
  });
  editors.push(editor);
  return editor;
}

const bodyOf = (editor: Editor) => docToBodyMarkup(editor.getJSON());
const subjectOf = (editor: Editor) => docToSubjectText(editor.getJSON());

function chips(editor: Editor): { pos: number; node: ProseMirrorNode }[] {
  const found: { pos: number; node: ProseMirrorNode }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "mergeTag") found.push({ pos, node });
  });
  return found;
}

function chipElements(editor: Editor): HTMLElement[] {
  return [...editor.view.dom.querySelectorAll<HTMLElement>("span[data-merge-tag]")];
}

// Selects the given text within the document.
function selectText(editor: Editor, needle: string) {
  let from = -1;
  editor.state.doc.descendants((node, pos) => {
    if (from === -1 && node.isText && node.text?.includes(needle)) from = pos + node.text.indexOf(needle);
  });
  if (from === -1) throw new Error(`"${needle}" not found`);
  editor.commands.setTextSelection({ from, to: from + needle.length });
}

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

describe("variable chips", () => {
  it("A: inserting a variable creates exactly one atomic chip", () => {
    const editor = bodyEditor("Hi ");
    editor.commands.focus("end");
    editor.commands.insertContent({ type: "mergeTag", attrs: { tag: "first_name" } });

    const [chip] = chips(editor);
    expect(chips(editor)).toHaveLength(1);
    expect(chip.node.isAtom).toBe(true);
    expect(chip.node.nodeSize).toBe(1);

    const [element] = chipElements(editor);
    expect(element.getAttribute("contenteditable")).toBe("false");
    expect(element.getAttribute("data-merge-tag")).toBe("first_name");
    expect(element.textContent).toBe("First Name");
    expect(bodyOf(editor)).toBe("Hi {{first_name}}");
  });

  it("B: supports multiple variables in the body", () => {
    const editor = bodyEditor("Hi ");
    editor.commands.focus("end");
    editor.commands.insertContent({ type: "mergeTag", attrs: { tag: "first_name" } });
    editor.commands.insertContent(" from ");
    editor.commands.insertContent({ type: "mergeTag", attrs: { tag: "company" } });
    editor.commands.insertContent({ type: "mergeTag", attrs: { tag: "job_title" } });

    expect(chips(editor).map(({ node }) => node.attrs.tag)).toEqual(["first_name", "company", "job_title"]);
    expect(bodyOf(editor)).toBe("Hi {{first_name}} from {{company}}{{job_title}}");
  });

  it("C: deleting a selected chip removes the whole variable", () => {
    const editor = bodyEditor("Hi {{first_name}}!");
    const [chip] = chips(editor);
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, chip.pos)));
    editor.commands.keyboardShortcut("Backspace");

    expect(chips(editor)).toHaveLength(0);
    expect(bodyOf(editor)).toBe("Hi !");
  });

  it("C: a deletion can only ever take a chip whole — it has no inner positions to split", () => {
    const editor = bodyEditor("Hi {{first_name}}!");
    const [chip] = chips(editor);

    editor.commands.deleteRange({ from: chip.pos - 1, to: chip.pos });
    expect(bodyOf(editor)).toBe("Hi{{first_name}}!");

    const [moved] = chips(editor);
    editor.commands.deleteRange({ from: moved.pos, to: moved.pos + 1 });
    expect(bodyOf(editor)).toBe("Hi!");
  });

  it("D: text typed immediately before and after a chip leaves it intact", () => {
    const editor = bodyEditor("{{first_name}}");
    const [chip] = chips(editor);

    editor.commands.setTextSelection(chip.pos);
    editor.commands.insertContent("Dear ");
    const [after] = chips(editor);
    editor.commands.setTextSelection(after.pos + 1);
    editor.commands.insertContent(", welcome");

    expect(chips(editor)).toHaveLength(1);
    expect(bodyOf(editor)).toBe("Dear {{first_name}}, welcome");

    selectText(editor, "Dear");
    editor.commands.insertContent("Hello");
    expect(bodyOf(editor)).toBe("Hello {{first_name}}, welcome");
  });

  it("E: loading existing {{variable}} text converts each variable into a chip", () => {
    const editor = bodyEditor("Hi {{first_name}}, about {{ Company Name }} and {{custom_fields.role}}");
    expect(chips(editor).map(({ node }) => node.attrs.tag)).toEqual(["first_name", "Company Name", "custom_fields.role"]);
    expect(chipElements(editor).map((element) => element.textContent)).toEqual([
      "First Name",
      "Company Name",
      "custom_fields.role",
    ]);
  });

  it("F: saving serializes chips back to canonical {{variable}} syntax", () => {
    const editor = bodyEditor("Hi {{ first_name }}");
    editor.commands.focus("end");
    editor.commands.insertContent(" at ");
    editor.commands.insertContent({ type: "mergeTag", attrs: { tag: "company" } });
    expect(bodyOf(editor)).toBe("Hi {{first_name}} at {{company}}");
  });

  it("turns {{variable}} pasted as text into chips", () => {
    const editor = bodyEditor("");
    editor.view.pasteText("Hi {{first_name}} and {{company}}");
    expect(chips(editor).map(({ node }) => node.attrs.tag)).toEqual(["first_name", "company"]);
    expect(bodyOf(editor)).toBe("Hi {{first_name}} and {{company}}");
  });

  it("turns {{variable}} typed by hand into a chip once its closing braces are typed", () => {
    const editor = bodyEditor("");
    editor.commands.focus("end");
    for (const char of "Hi {{first_name}}") {
      const { from, to } = editor.state.selection;
      const handled = editor.view.someProp("handleTextInput", (handler) =>
        handler(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to)),
      );
      if (!handled) editor.view.dispatch(editor.state.tr.insertText(char, from, to));
    }
    expect(chips(editor).map(({ node }) => node.attrs.tag)).toEqual(["first_name"]);
    expect(bodyOf(editor)).toBe("Hi {{first_name}}");
  });

  it("undo removes an inserted chip", () => {
    const editor = bodyEditor("Hi ");
    editor.commands.focus("end");
    editor.commands.insertContent({ type: "mergeTag", attrs: { tag: "first_name" } });
    editor.commands.undo();
    expect(bodyOf(editor)).toBe("Hi");
  });

  describe("G: subject", () => {
    it("supports chips, before and after text, and serializes to plain {{variable}} text", () => {
      const editor = subjectEditor("Quick question for ");
      editor.commands.focus("end");
      editor.commands.insertContent({ type: "mergeTag", attrs: { tag: "company" } });
      editor.commands.insertContent("?");

      expect(chips(editor)).toHaveLength(1);
      expect(subjectOf(editor)).toBe("Quick question for {{company}}?");
    });

    it("loads an existing subject's variables as chips", () => {
      const editor = subjectEditor("Hi {{first_name}} — {{company}}");
      expect(chips(editor).map(({ node }) => node.attrs.tag)).toEqual(["first_name", "company"]);
      expect(subjectOf(editor)).toBe("Hi {{first_name}} — {{company}}");
    });

    it("stays one line with no formatting", () => {
      const editor = subjectEditor("One line");
      editor.commands.focus("end");
      editor.commands.keyboardShortcut("Enter");
      editor.commands.keyboardShortcut("Mod-b");
      expect(editor.getJSON().content).toHaveLength(1);
      expect(editor.schema.marks.bold).toBeUndefined();
      expect(subjectOf(editor)).toBe("One line");
    });

    it("keeps literal * and _ in a subject unchanged", () => {
      const editor = subjectEditor("5 * 3 _deal_ for {{company}}");
      expect(subjectOf(editor)).toBe("5 * 3 _deal_ for {{company}}");
    });
  });

  describe("H: unknown variables", () => {
    it("shows an unknown variable as a flagged chip and saves it unchanged", () => {
      const editor = bodyEditor("Hi {{favorite_color}}");
      const [element] = chipElements(editor);
      expect(element.getAttribute("aria-label")).toBe("Unknown variable: favorite_color");
      expect(element.className).toContain("text-destructive");
      expect(bodyOf(editor)).toBe("Hi {{favorite_color}}");
    });

    it("strips braces from a chip pasted as HTML so it can't break its {{…}}", () => {
      const editor = bodyEditor("");
      editor.commands.setContent('<p>Hi <span data-merge-tag="first}}{{_name">x</span></p>');
      expect(chips(editor).map(({ node }) => node.attrs.tag)).toEqual(["first_name"]);
      expect(bodyOf(editor)).toBe("Hi {{first_name}}");
    });
  });
});

describe("rich-text formatting", () => {
  it("I: bold", () => {
    const editor = bodyEditor("Make this bold please");
    selectText(editor, "this bold");
    editor.commands.toggleBold();
    expect(bodyOf(editor)).toBe("Make **this bold** please");
  });

  it("J: italic", () => {
    const editor = bodyEditor("Make this italic please");
    selectText(editor, "this italic");
    editor.commands.toggleItalic();
    expect(bodyOf(editor)).toBe("Make _this italic_ please");
  });

  it("formatting a selection that includes a chip keeps the chip", () => {
    const editor = bodyEditor("Hi {{first_name}} there");
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
    editor.commands.toggleBold();
    expect(bodyOf(editor)).toBe("**Hi {{first_name}} there**");
  });

  it("K: hyperlink", () => {
    const editor = bodyEditor("Book a call today");
    selectText(editor, "Book a call");
    expect(editor.commands.setLink({ href: "https://cal.com/acme" })).toBe(true);
    expect(bodyOf(editor)).toBe("[Book a call](https://cal.com/acme) today");
  });

  it("K: a whole-href variable is allowed as a link target", () => {
    const editor = bodyEditor("Unsubscribe");
    selectText(editor, "Unsubscribe");
    expect(editor.commands.setLink({ href: "{{unsubscribe_link}}" })).toBe(true);
    expect(bodyOf(editor)).toBe("[Unsubscribe]({{unsubscribe_link}})");
  });

  it("N: rejects unsafe link schemes, typed or pasted", () => {
    const editor = bodyEditor("Click here");
    selectText(editor, "Click here");
    expect(editor.commands.setLink({ href: "javascript:alert(1)" })).toBe(false);
    expect(editor.commands.setLink({ href: "data:text/html,x" })).toBe(false);
    expect(bodyOf(editor)).toBe("Click here");

    editor.commands.setContent('<p><a href="javascript:alert(1)">bad</a> <a href="https://ok.com">good</a></p>');
    expect(bodyOf(editor)).toBe("bad [good](https://ok.com)");
  });

  it("L: Enter starts a paragraph and Shift+Enter a line break", () => {
    const editor = bodyEditor("First");
    editor.commands.focus("end");
    editor.commands.keyboardShortcut("Enter");
    editor.commands.insertContent("Second");
    editor.commands.keyboardShortcut("Shift-Enter");
    editor.commands.insertContent("still second");
    expect(bodyOf(editor)).toBe("First\n\nSecond\nstill second");
  });

  it("drops pasted formatting the email can't carry (headings, images, lists)", () => {
    const editor = bodyEditor("");
    editor.commands.setContent('<h1>Title</h1><ul><li>item</li></ul><p>x<img src="https://a.com/i.png"></p>');
    expect(bodyOf(editor)).toBe("Title\n\nitem\n\nx");
  });

  it("round-trips an existing formatted body unchanged", () => {
    const markup = "Hi {{first_name}},\n\n**Bold** and _italic_ with [a link](https://acme.com/x?y=1).\nhttps://acme.com/a_b";
    expect(bodyOf(bodyEditor(markup))).toBe(markup);
  });

  it("round-trips an existing plain-text body unchanged", () => {
    const markup = "Hi {{first_name}},\n\nQuick question about {{company}} — my_team uses it.\nThanks!";
    expect(bodyOf(bodyEditor(markup))).toBe(markup);
  });
});

describe("ComposerEditor (React)", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  async function mount(props: Parameters<typeof ComposerEditor>[0]) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(createElement(ComposerEditor, props)));
  }

  it("inserts a picker variable as a chip and reports the canonical value", async () => {
    const onChange = vi.fn();
    const ref = createRef<ComposerEditorHandle>();
    await mount({ variant: "body", ariaLabel: "Body", value: "Hi ", onChange, ref });

    await act(async () => ref.current!.insertMergeTag("first_name"));

    expect(container!.querySelector('span[data-merge-tag="first_name"]')).not.toBeNull();
    expect(onChange).toHaveBeenLastCalledWith("Hi {{first_name}}");
  });

  it("replaces its content when the value changes from outside (a template is applied)", async () => {
    const onChange = vi.fn();
    await mount({ variant: "body", ariaLabel: "Body", value: "Old", onChange });
    await act(async () =>
      root!.render(createElement(ComposerEditor, { variant: "body", ariaLabel: "Body", value: "New {{company}}", onChange })),
    );

    expect(container!.querySelector('[role="textbox"]')!.textContent).toBe("New Company");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("labels the editable region for assistive tech", async () => {
    await mount({ variant: "subject", ariaLabel: "Subject", value: "", onChange: vi.fn(), id: "subject-field" });
    const textbox = container!.querySelector('[role="textbox"]')!;
    expect(textbox.getAttribute("aria-label")).toBe("Subject");
    expect(textbox.getAttribute("aria-multiline")).toBe("false");
    expect(textbox.id).toBe("subject-field");
  });
});
