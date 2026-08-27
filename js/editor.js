// The text editor, mounted on one note at a time.
//
// A ProseMirror view per note would be untenable on an infinite canvas, but
// only one note is ever active, so the editor follows it: mounted when a note
// is activated, destroyed when it is left. Every other note on the board is
// static HTML, which is also exactly what we store.
//
// Nothing here adds chrome. Formatting is keyboard and typing only — "- " for
// a bullet, "# " for a heading, ⌘B and friends — so a note still looks like a
// note rather than a word processor.

import {
  Editor,
  Extension,
  Document,
  Paragraph,
  Text,
  HardBreak,
  Heading,
  Blockquote,
  CodeBlock,
  Bold,
  Italic,
  Underline,
  Strike,
  Code,
  Link,
  BulletList,
  OrderedList,
  ListItem,
  TaskList,
  TaskItem,
  ListKeymap,
  Image,
  UndoRedo,
  Placeholder,
} from "./vendor/tiptap.js";

export const PLACEHOLDER = "Type or paste here…";

/**
 * The three text sizes, carried as the classes we already store.
 *
 * They predate the schema, so they have to survive it: a note written before
 * this editor existed holds `<div class="t-title">`, and it must come back out
 * the same way rather than being quietly flattened on first edit.
 */
const TextSize = Extension.create({
  name: "textSize",

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          size: {
            default: null,
            parseHTML: (element) =>
              element.classList.contains("t-title")
                ? "title"
                : element.classList.contains("t-small")
                  ? "small"
                  : null,
            renderHTML: (attributes) => (attributes.size ? { class: `t-${attributes.size}` } : {}),
          },
        },
      },
    ];
  },

  addKeyboardShortcuts() {
    // Chrome claims ⌘1..9 for tab switching, so these carry Alt as well.
    const size = (value) => () =>
      this.editor.chain().focus().setParagraph().updateAttributes("paragraph", { size: value }).run();
    return {
      "Mod-Alt-1": size("title"),
      "Mod-Alt-2": size("small"),
      "Mod-Alt-0": size(null),
    };
  },
});

const BLOCK_INSIDE = "p,div,ul,ol,li,h1,h2,h3,h4,h5,h6,blockquote,pre,table,figure,img,hr";

/**
 * Paragraphs, but a `div` holding a line of text counts as one.
 *
 * Everything written in v3 before this editor arrived is a stack of plain
 * divs, straight out of the contenteditable, and without a rule for them the
 * text survives but the element it was written on — and the t-title / t-small
 * class riding on it — does not.
 *
 * The catch is that the web is made of divs. Matching every one turned each
 * wrapper on a copied page into an empty paragraph, so a paste arrived under
 * a stack of blank lines. Only a div with nothing block-level inside it is a
 * line of text; the rest are scaffolding, and are descended into instead.
 */
const NoteParagraph = Paragraph.extend({
  parseHTML() {
    return [
      { tag: "p" },
      {
        // Below the default of 50, so anything more specific still wins.
        tag: "div",
        priority: 25,
        getAttrs: (element) => {
          if (element.querySelector(BLOCK_INSIDE)) return false; // scaffolding
          // A blank line was written as <div><br></div>; an empty wrapper was
          // not written at all.
          const empty = !element.textContent.trim() && !element.querySelector("br");
          return empty ? false : null;
        },
      },
    ];
  },
});

/**
 * Images are blobs in IndexedDB, referenced by id.
 *
 * The src is a per-session blob URL and is stripped before saving, so the
 * stored markup is `<img data-img-id>` with no src at all — which the stock
 * `img[src]` parse rule would skip straight past.
 */
const NoteImage = Image.extend({
  parseHTML() {
    return [{ tag: "img[data-img-id]" }, { tag: "img[src]" }];
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      imgId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-img-id"),
        renderHTML: (attributes) => (attributes.imgId ? { "data-img-id": attributes.imgId } : {}),
      },
    };
  },
});

function extensions() {
  return [
    Document,
    NoteParagraph,
    Text,
    HardBreak,
    // Levels 1-4 because the v1 import emits all four; typing "# " still only
    // reaches for the first two in practice.
    Heading.configure({ levels: [1, 2, 3, 4] }),
    Blockquote,
    CodeBlock,

    Bold,
    Italic,
    Underline,
    Strike,
    Code,
    Link.configure({
      openOnClick: true,
      autolink: true,
      defaultProtocol: "https",
      protocols: ["http", "https", "mailto"],
      HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
    }),

    BulletList,
    OrderedList,
    ListItem,
    TaskList,
    TaskItem.configure({ nested: true }),
    ListKeymap,

    NoteImage,
    TextSize,
    UndoRedo, // per note, and scoped to it — ⌘Z on the board still undoes a delete
    Placeholder.configure({ placeholder: PLACEHOLDER }),
  ];
}

/** Everything the stored markup may contain, so a save cannot invent src. */
export function cleanHtml(html) {
  const holder = document.createElement("div");
  holder.innerHTML = html || "";
  holder.querySelectorAll("img[data-img-id]").forEach((img) => img.removeAttribute("src"));
  return holder.innerHTML;
}

/**
 * Put an editor on a note.
 *
 * `onChange` receives the note's markup, already stripped of blob URLs.
 * `onImages` is handed pasted image files; it stores them and calls back with
 * `{ id, url }` so the node can be inserted.
 */
export function mountEditor(body, html, { onChange, onImages }) {
  body.innerHTML = ""; // the static copy the editor is replacing

  const editor = new Editor({
    element: body,
    content: html || "",
    extensions: extensions(),
    editorProps: {
      handlePaste: (view, event) => {
        const files = [...(event.clipboardData?.items || [])]
          .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
          .map((item) => item.getAsFile())
          .filter(Boolean);
        if (!files.length) return false; // text: let ProseMirror sanitise it
        event.preventDefault();
        onImages(files);
        return true;
      },
    },
    onUpdate: ({ editor: instance }) => onChange(cleanHtml(instance.getHTML())),
  });

  return editor;
}

/** Insert a stored image at the caret. */
export function insertImage(editor, { id, url }) {
  editor.chain().focus().setImage({ src: url, imgId: id }).run();
}

/** Put the caret where the note was clicked, the way a click normally would. */
export function caretAt(editor, x, y) {
  const at = editor.view.posAtCoords({ left: x, top: y });
  editor.commands.focus(at ? at.pos : "end");
}

/** The href under the caret, if the caret is in a link. */
export function linkAtCaret(editor) {
  return editor.getAttributes("link").href || "";
}

export function applyLink(editor, href) {
  const chain = editor.chain().focus().extendMarkRange("link");
  if (href) chain.setLink({ href }).run();
  else chain.unsetLink().run();
}
