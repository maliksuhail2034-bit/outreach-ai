"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from "@tiptap/react";
import { BoldIcon, ItalicIcon, Link2OffIcon, LinkIcon } from "lucide-react";

import {
  bodyMarkupToDoc,
  docToBodyMarkup,
  docToSubjectText,
  isSafeLinkHref,
  subjectTextToDoc,
  type ComposerJsonNode,
} from "@/lib/email/composer-markup";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { bodyExtensions, subjectExtensions } from "./editor/composer-extensions";

export interface ComposerEditorHandle {
  insertMergeTag: (tag: string) => void;
}

type Variant = "body" | "subject";

const CONVERSIONS: Record<Variant, { toDoc: (value: string) => ComposerJsonNode; fromDoc: (doc: ComposerJsonNode) => string }> = {
  body: { toDoc: bodyMarkupToDoc, fromDoc: docToBodyMarkup },
  subject: { toDoc: subjectTextToDoc, fromDoc: docToSubjectText },
};

const FIELD_CLASS =
  "w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:border-destructive";
const PLACEHOLDER_CLASS =
  "[&_p.is-editor-empty:first-child]:before:pointer-events-none [&_p.is-editor-empty:first-child]:before:float-left [&_p.is-editor-empty:first-child]:before:h-0 [&_p.is-editor-empty:first-child]:before:text-muted-foreground [&_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]";
const VARIANT_CLASS: Record<Variant, string> = {
  body: "min-h-40 max-h-96 overflow-y-auto py-2 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_p+p]:mt-3",
  subject: "min-h-9 py-1.5",
};

// A rich-text field whose value is the stored markup string (see
// lib/email/composer-markup.ts), so it drops into react-hook-form like the
// Input/Textarea it replaces. `id`/`aria-*` arrive from FormControl.
export function ComposerEditor({
  variant,
  value,
  onChange,
  onBlur,
  onFocus,
  placeholder,
  ariaLabel,
  disabled = false,
  toolbarExtra,
  ref,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: {
  variant: Variant;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onFocus?: () => void;
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
  toolbarExtra?: ReactNode;
  ref?: Ref<ComposerEditorHandle>;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const { toDoc, fromDoc } = CONVERSIONS[variant];

  // The last value this editor produced, so a new `value` prop can be told
  // apart from the echo of the user's own typing (only the former — e.g. a
  // template being applied — replaces the editor's content).
  const lastEmittedRef = useRef(value);
  // Until the user has placed the cursor, a picked variable goes at the end
  // (as the old textarea did), not at the start of the field.
  const hasFocusedRef = useRef(false);
  const callbacksRef = useRef({ onChange, onBlur, onFocus });
  useEffect(() => {
    callbacksRef.current = { onChange, onBlur, onFocus };
  }, [onChange, onBlur, onFocus]);

  // Created once: useEditor pushes changed options into the live editor on
  // every render, so these must stay referentially stable.
  const [extensions] = useState(() => (variant === "body" ? bodyExtensions(placeholder) : subjectExtensions(placeholder)));
  const [initialContent] = useState(() => toDoc(value) as JSONContent);

  const attributes = useMemo(
    () => ({
      role: "textbox",
      "aria-label": ariaLabel,
      "aria-multiline": variant === "body" ? "true" : "false",
      ...(id ? { id } : {}),
      ...(ariaDescribedBy ? { "aria-describedby": ariaDescribedBy } : {}),
      ...(ariaInvalid ? { "aria-invalid": "true" } : {}),
      class: cn(FIELD_CLASS, PLACEHOLDER_CLASS, VARIANT_CLASS[variant], disabled && "cursor-not-allowed opacity-50"),
    }),
    [ariaLabel, variant, id, ariaDescribedBy, ariaInvalid, disabled],
  );
  const editorProps = useMemo(() => ({ attributes }), [attributes]);

  const editor = useEditor({
    extensions,
    content: initialContent,
    immediatelyRender: false,
    editable: !disabled,
    editorProps,
    onUpdate: ({ editor: current }) => {
      const next = fromDoc(current.getJSON());
      lastEmittedRef.current = next;
      callbacksRef.current.onChange(next);
    },
    onFocus: () => {
      hasFocusedRef.current = true;
      callbacksRef.current.onFocus?.();
    },
    onBlur: () => callbacksRef.current.onBlur?.(),
  });

  useEffect(() => {
    if (!editor || value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    editor.commands.setContent(toDoc(value) as JSONContent, { emitUpdate: false });
  }, [editor, value, toDoc]);

  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);

  useImperativeHandle(
    ref,
    () => ({
      insertMergeTag: (tag: string) => {
        editor
          ?.chain()
          .focus(hasFocusedRef.current ? null : "end")
          .insertContent({ type: "mergeTag", attrs: { tag } })
          .run();
      },
    }),
    [editor],
  );

  return (
    <div className="space-y-2">
      {variant === "body" && <FormattingToolbar editor={editor} disabled={disabled} extra={toolbarExtra} />}
      <EditorContent editor={editor} />
    </div>
  );
}

function FormattingToolbar({ editor, disabled, extra }: { editor: Editor | null; disabled: boolean; extra?: ReactNode }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? {
            bold: current.isActive("bold"),
            italic: current.isActive("italic"),
            link: current.isActive("link"),
            href: current.getAttributes("link").href as string | undefined,
          }
        : null,
  });
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  const inactive = !editor || disabled;

  function openLinkEditor() {
    setLinkError(null);
    setLinkDraft(state?.href ?? "https://");
  }

  function closeLinkEditor() {
    setLinkDraft(null);
    setLinkError(null);
    editor?.commands.focus();
  }

  function applyLink() {
    if (!editor || linkDraft === null) return;
    const trimmed = linkDraft.trim();
    // "acme.com" means https://acme.com; anything with a scheme (or a lone
    // {{variable}} such as {{unsubscribe_link}}) is checked as written.
    const href = isSafeLinkHref(trimmed) || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    if (!isSafeLinkHref(href)) {
      setLinkError("Use a web address starting with http:// or https://, or a single variable such as {{unsubscribe_link}}.");
      return;
    }
    const chain = editor.chain().focus().extendMarkRange("link");
    if (editor.state.selection.empty && !editor.isActive("link")) {
      chain.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
    } else {
      chain.setLink({ href }).run();
    }
    setLinkDraft(null);
    setLinkError(null);
  }

  function removeLink() {
    editor?.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkDraft(null);
  }

  // mousedown, not click: keeps the editor's selection while a toolbar
  // button is pressed.
  const keepSelection = (event: React.MouseEvent) => event.preventDefault();

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Formatting">
        <Button
          type="button"
          variant={state?.bold ? "secondary" : "ghost"}
          size="sm"
          className="h-7 w-7 px-0"
          aria-label="Bold"
          aria-pressed={state?.bold ?? false}
          disabled={inactive}
          onMouseDown={keepSelection}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <BoldIcon />
        </Button>
        <Button
          type="button"
          variant={state?.italic ? "secondary" : "ghost"}
          size="sm"
          className="h-7 w-7 px-0"
          aria-label="Italic"
          aria-pressed={state?.italic ?? false}
          disabled={inactive}
          onMouseDown={keepSelection}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <ItalicIcon />
        </Button>
        <Button
          type="button"
          variant={state?.link ? "secondary" : "ghost"}
          size="sm"
          className="h-7 w-7 px-0"
          aria-label={state?.link ? "Edit link" : "Add link"}
          aria-pressed={state?.link ?? false}
          disabled={inactive}
          onMouseDown={keepSelection}
          onClick={openLinkEditor}
        >
          <LinkIcon />
        </Button>
        {extra && <div className="ml-1 border-l border-border pl-2">{extra}</div>}
      </div>

      {linkDraft !== null && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              autoFocus
              aria-label="Link address"
              aria-invalid={linkError ? true : undefined}
              className="h-8 min-w-0 flex-1"
              value={linkDraft}
              onChange={(event) => setLinkDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyLink();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  closeLinkEditor();
                }
              }}
            />
            <Button type="button" size="sm" onClick={applyLink}>
              Apply
            </Button>
            {state?.link && (
              <Button type="button" size="sm" variant="outline" onClick={removeLink}>
                <Link2OffIcon />
                Remove
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" onClick={closeLinkEditor}>
              Cancel
            </Button>
          </div>
          {linkError && <p className="text-xs text-destructive">{linkError}</p>}
        </div>
      )}
    </div>
  );
}
