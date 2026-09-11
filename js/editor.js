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
  mergeAttributes,
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
  Table,
  TableRow,
  TableHeader,
  TableCell,
  Gapcursor,
  UndoRedo,
  Suggestion,
  SuggestionPluginKey,
  Plugin,
  PluginKey,
  Decoration,
  DecorationSet,
  Parser,
} from "./vendor/tiptap.js";
import { expressionAt, calculate, answerText } from "./calc.js";
import { attachBubble } from "./bubble.js";
import { attachTableControls } from "./table.js";

/* There is no placeholder any more. Prompting an empty note with "type here"
   said nothing the caret sitting in it did not, and it said it in every empty
   note on the board at once — a page of grey instructions to read past. */

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

  addCommands() {
    return {
      setTextSize:
        (size) =>
        ({ chain }) =>
          chain().focus().setParagraph().updateAttributes("paragraph", { size }).run(),

      // One rung up or down the ladder, the way ### becomes ## becomes #.
      stepTextSize:
        (direction) =>
        ({ editor, chain }) => {
          const next = RUNGS[clampRung(rungOf(editor) + direction)];
          return next.apply(chain().focus()).run();
        },
    };
  },

  addKeyboardShortcuts() {
    // Chrome claims ⌘1..9 for tab switching, so these carry Alt as well.
    return {
      "Mod-Alt-1": () => this.editor.commands.stepTextSize(1),
      "Mod-Alt-2": () => this.editor.commands.stepTextSize(-1),
      "Mod-Alt-0": () => this.editor.commands.setTextSize(null),
    };
  },
});

/**
 * The size ladder, smallest first.
 *
 * Two fixed sizes turned out to be two buttons that had to be learnt. A pair
 * of steppers is the same thing anyone already knows from markdown: press it
 * again and the text goes up another level.
 *
 * The lower rungs are paragraphs carrying a class, because there is no node
 * for "smaller than body"; the upper ones are real headings. A note written
 * before this existed holds a `t-title` paragraph, which sits on the same rung
 * as an h2 so stepping off it goes somewhere sensible.
 */
const RUNGS = [
  { id: "small", apply: (chain) => chain.setParagraph().updateAttributes("paragraph", { size: "small" }) },
  { id: "body", apply: (chain) => chain.setParagraph().updateAttributes("paragraph", { size: null }) },
  { id: "h3", apply: (chain) => chain.setNode("heading", { level: 3, size: null }) },
  { id: "h2", apply: (chain) => chain.setNode("heading", { level: 2, size: null }) },
  { id: "h1", apply: (chain) => chain.setNode("heading", { level: 1, size: null }) },
];

const HEADING_RUNG = { 3: 2, 2: 3, 1: 4 };

export function rungOf(editor) {
  for (const level of [1, 2, 3]) {
    if (editor.isActive("heading", { level })) return HEADING_RUNG[level];
  }
  if (editor.isActive("heading", { level: 4 })) return 2; // only the v1 import makes these
  const size = editor.getAttributes("paragraph").size;
  if (size === "small") return 0;
  if (size === "title") return 3;
  return 1;
}

export const TOP_RUNG = RUNGS.length - 1;

function clampRung(rung) {
  return Math.max(0, Math.min(TOP_RUNG, rung));
}

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

/**
 * A table is as wide as the note and no wider.
 *
 * Tiptap renders a `<colgroup>` and a `min-width` sized off the column count,
 * which is what a spreadsheet wants: columns keep their own widths and the
 * table scrolls sideways. A note is not a spreadsheet — there is nowhere to
 * scroll to and no handles to set a width with — so the markup goes out plain
 * and `table-layout: fixed` in the stylesheet shares the note's width out
 * evenly. It also keeps what we store down to a table, rows and cells.
 */
const NoteTable = Table.extend({
  renderHTML({ HTMLAttributes }) {
    return ["table", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), ["tbody", 0]];
  },
});

/**
 * A table arriving from Sheets, Excel or a web page brings its own widths —
 * a `<colgroup>`, or `width=` on the cells — measured for the window it was
 * copied out of. Kept, they would pin the columns to somebody else's layout;
 * dropped, a pasted table looks like one that was inserted here.
 */
function withoutWidths(html) {
  return html
    .replace(/<colgroup>[\s\S]*?<\/colgroup>/gi, "")
    .replace(/\swidth="[^"]*"/gi, "")
    .replace(/\swidth:\s*[^;"]+;?/gi, "");
}

/* --------------------------------------------------------- slash commands */

// Typing "/" in a note lists what can be put on the board from there — the
// apps, for now. Picking one takes the "/timer" back out of the note and hands
// the app to whoever mounted the editor, which puts it down beside the note.
// The note keeps its words: the command was an instruction, not content.
//
// The list is drawn here, by hand. Suggestion only finds the "/" and what has
// been typed after it; a popover library to position one box would be more
// code than the box.
const SlashCommands = Extension.create({
  name: "slashCommands",

  addOptions() {
    return { items: () => [], onPick: () => {} };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: "/",
        // "and/or", a date, a path: a slash inside a word is a slash. Only one
        // at the start of a line or after a space opens the list.
        allowedPrefixes: [" "],
        items: ({ query }) => this.options.items(query),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          this.options.onPick(props);
        },
        render: slashMenu,
      }),
    ];
  },
});

function slashMenu() {
  let menu = null;
  let items = [];
  let index = 0;
  let pick = () => {};

  const paint = () => {
    if (!menu) return;
    menu.textContent = "";
    // Nothing matches: no box at all, and the typing is just typing.
    menu.hidden = !items.length;
    items.forEach((item, i) => {
      const row = document.createElement("button");
      row.className = "ctx-item slash-item";
      row.classList.toggle("is-active", i === index);
      const name = document.createElement("span");
      name.textContent = item.title;
      const hint = document.createElement("span");
      hint.className = "slash-hint";
      hint.textContent = `/${item.name}`;
      row.append(name, hint);
      // mousedown, not click, and cancelled: a click would take focus out of
      // the note first, and the suggestion goes with it.
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pick(item);
      });
      menu.appendChild(row);
    });
  };

  const place = (clientRect) => {
    const r = clientRect && clientRect();
    if (!menu || !r) return;
    menu.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - menu.offsetWidth - 6))}px`;
    menu.style.top = `${Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 6)}px`;
  };

  const take = (props) => {
    items = props.items;
    pick = props.command;
    index = Math.min(index, Math.max(0, items.length - 1));
  };

  return {
    onStart(props) {
      menu = document.createElement("div");
      menu.className = "ctx-menu slash-menu";
      document.body.appendChild(menu);
      index = 0;
      take(props);
      paint();
      place(props.clientRect);
    },
    onUpdate(props) {
      take(props);
      paint();
      place(props.clientRect);
    },
    onKeyDown({ event }) {
      if (!menu || menu.hidden || !items.length) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        index = (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
        paint();
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        pick(items[index]);
        return true;
      }
      if (event.key === "Escape") {
        // Closes the list and nothing else; the note stays open, and the "/"
        // stays as typed. Stopped here, so the board's own Escape — which
        // would close the note — never hears it.
        menu.hidden = true;
        event.stopPropagation();
        return true;
      }
      return false;
    },
    onExit() {
      if (menu) menu.remove();
      menu = null;
    },
  };
}

/* ------------------------------------------------------------------- sums */

// Type a sum at the end of a line and its answer is already there after it,
// dimmed: "120*0.15" shows " = 18". Tab or Enter makes it real text; Esc, or
// typing something that is no longer a sum, and it is gone. It is a widget
// decoration — drawn in the line, never in the document — standing exactly
// where the answer would go, so accepting it changes nothing on screen but
// its colour. What counts as a sum is js/calc.js's business.
//
// Once written, an answer is just text. Changing the sum later does not change
// it; that would be a spreadsheet, which a note is not.
const sums = new PluginKey("sums");
const parser = new Parser();
const evaluate = (expr) => parser.evaluate(expr);

// The ghost for a state, or null. Only with the caret at the very end of a
// line: anywhere else the answer would push the rest of the line along.
function ghostFor(state, dismissed) {
  const { selection } = state;
  if (!selection.empty) return null;
  // "/" and its list come first; a sum never needs to share the line with one.
  if (SuggestionPluginKey.getState(state)?.active) return null;
  const { $from } = selection;
  const block = $from.parent;
  if (!block.isTextblock || block.type.spec.code) return null;
  if ($from.parentOffset !== block.content.size) return null;

  // A hard break or a picture stands in as a character no sum contains, so a
  // sum never reaches back across one.
  const line = block.textBetween(0, $from.parentOffset, undefined, "\ufffc");
  const expr = expressionAt(line);
  if (!expr) return null;
  if (dismissed && dismissed.at === $from.start() && dismissed.expr === expr) return null;
  const result = calculate(expr, evaluate);
  if (result === null) return null;
  return { pos: $from.pos, text: answerText(line, result), expr, at: $from.start() };
}

const Sums = Extension.create({
  name: "sums",
  // Ahead of the list keymaps, so Tab and Enter reach the ghost first — and
  // only then, since everything below lets go the moment there is none.
  priority: 1000,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: sums,
        state: {
          init: (_, state) => ({ ghost: ghostFor(state, null), dismissed: null }),
          apply(tr, previous, _old, state) {
            const dismissed = tr.getMeta(sums)?.dismiss || previous.dismissed;
            return { ghost: ghostFor(state, dismissed), dismissed };
          },
        },
        props: {
          decorations(state) {
            const { ghost } = sums.getState(state);
            if (!ghost) return null;
            const widget = Decoration.widget(
              ghost.pos,
              () => {
                const span = document.createElement("span");
                span.className = "sum-ghost";
                span.textContent = ghost.text;
                return span;
              },
              // After the caret, so the caret stays where the typing is; keyed
              // by its text, so the same answer is not redrawn every keystroke.
              { side: 1, key: ghost.text, ignoreSelection: true }
            );
            return DecorationSet.create(state.doc, [widget]);
          },
          handleKeyDown(view, event) {
            const { ghost } = sums.getState(view.state);
            if (!ghost) return false;
            if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
            if (event.key === "Tab" || event.key === "Enter") {
              view.dispatch(view.state.tr.insertText(ghost.text, ghost.pos).scrollIntoView());
              return true;
            }
            if (event.key === "Escape") {
              // This sum, until it changes. Stopped here, so the board's own
              // Escape — which would close the note — never hears it.
              view.dispatch(view.state.tr.setMeta(sums, { dismiss: { at: ghost.at, expr: ghost.expr } }));
              event.stopPropagation();
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});

function extensions({ commands } = {}) {
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
    // Rows and columns are added and deleted from the hover controls in
    // js/table.js; there is no resizing, so no drag handles come with it.
    // `View: null` turns off Tiptap's own table node view, which exists to
    // draw the colgroup of pixel widths that resizing needs. Without it the
    // table on screen is the same markup we store.
    NoteTable.configure({ resizable: false, View: null, HTMLAttributes: { class: "note-table" } }),
    TableRow,
    TableHeader,
    TableCell,
    // A table can be the last thing in a note, or the first, and then there is
    // no line to click on above or below it. This is the caret that can stand
    // in those places; typing there makes the paragraph that was missing.
    Gapcursor,
    ...(commands ? [SlashCommands.configure(commands)] : []),
    Sums,
    TextSize,
    UndoRedo, // per note, and scoped to it — outside a note ⌘Z is the board's own
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
// `commands`, when given, is `{ items(query), onPick(item) }` for the "/" list.
export function mountEditor(body, html, { onChange, onImages, commands }) {
  body.innerHTML = ""; // the static copy the editor is replacing

  const editor = new Editor({
    element: body,
    content: html || "",
    extensions: extensions({ commands }),
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
      transformPastedHTML: withoutWidths,
    },
    onUpdate: ({ editor: instance }) => onChange(cleanHtml(instance.getHTML())),
  });

  attachBubble(editor);
  attachTableControls(editor, body);
  return editor;
}

/**
 * Drop clipboard content in at the caret.
 *
 * The paste you get from ⌘V is ProseMirror's; this is the same thing reached
 * from the note's own menu, where there is no paste event to ride on. Without
 * formatting, the markup is never parsed at all — the text arrives as text,
 * which is the whole point of asking for it that way.
 */
export function pasteInto(editor, { html = "", text = "" } = {}, { formatted = true } = {}) {
  if (formatted && html) {
    editor.chain().focus().insertContent(html).run();
    return true;
  }
  if (!text) return false;

  // One line goes in where the caret is; several become paragraphs, the way
  // they would if they had been typed.
  const lines = text.split(/\r?\n/);
  const content =
    lines.length === 1
      ? [{ type: "text", text }]
      : lines.map((line) => ({
          type: "paragraph",
          content: line ? [{ type: "text", text: line }] : [],
        }));
  editor.chain().focus().insertContent(content).run();
  return true;
}

/** A 3x3 table at the caret. No header row: one less thing to explain. */
export function insertTable(editor) {
  editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: false }).run();
  // A table put in at the end of a note would leave nowhere to go on writing:
  // no line under it to click on, only the table. So it comes with one — left
  // empty, and with the caret staying up in the first cell where it belongs.
  const { doc } = editor.state;
  if (doc.lastChild && doc.lastChild.type.name === "table") {
    editor.commands.insertContentAt(doc.content.size, { type: "paragraph" }, { updateSelection: false });
  }
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
