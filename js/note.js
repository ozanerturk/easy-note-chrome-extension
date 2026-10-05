import { NOTES, IMAGES, put, putKeeping, patch, del, delMany, getOne, getAll } from "./db.js";
import { isPanGesture, GRID } from "./view.js";
import { notes } from "./store.js";
import { forgetSelection } from "./selection.js";
import { currentPageId } from "./pages.js";
import { listCount, refreshList, placeList } from "./list.js";
import { appFor, allApps, appForKeyword, mountApp } from "./apps/registry.js";
// Apps register themselves on import, and the board only knows the ones it has
// imported. Nothing else reaches into js/apps/, so this line is the whole
// install step for a new one.
import "./apps/timer.js";
import { setPref } from "./prefs.js";
import { offerUndo } from "./undo.js";
import { record, forget } from "./history.js";
import { linkifyText, promptForLink } from "./richtext.js";
import { showMenu } from "./menu.js";
import { markUsed } from "./tips.js";
import { mountEditor, insertImage, insertTable, pasteInto, linkAtCaret, applyLink, cleanHtml } from "./editor.js";
import { readClipboard, hasContent, pasteByCommand } from "./clipboard.js";
import { encodeNotes, decodeNotes } from "./noteclip.js";
import { toast } from "./toast.js";
import { inBounds } from "./origin.js";
import { forgetFloating, unfloatNote } from "./floating.js";
import {
  PRESETS,
  isDue,
  remindLabel,
  trackReminder,
  askToNotify,
  onReminderTick,
  defaultCustomTime,
} from "./reminders.js";

// No fill is the default: a new note is just text on the canvas, and colour
// is something you reach for when you want it to mean something.
export const NO_FILL = "transparent";

export const COLORS = [
  NO_FILL,
  "#ffffff",
  "#ececec",
  "#c9c9c9",
  "#fff6a3",
  "#ffe680",
  "#ffe0bd",
  "#ffc17a",
  "#ffd6d6",
  "#ffb3b3",
  "#ffd9ec",
  "#e6d6ff",
  "#d6f5d6",
  "#a8e6a3",
  "#d3f2f0",
  "#8fd9d4",
  "#d6e8ff",
  "#a9cdf5",
];

const overlay = document.getElementById("overlay");
const hint = document.getElementById("hint");

export { notes };

const objectUrls = new Set();
let zCounter = 1;
let fullscreenEntry = null;

/* ----------------------------------------------------------------- helpers */

export function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export function imageIdsIn(html) {
  const holder = document.createElement("div");
  holder.innerHTML = html || "";
  return [...holder.querySelectorAll("img[data-img-id]")].map((img) => img.dataset.imgId);
}

// Blob URLs, kept by image id. The static copy of a note resolves them on
// render, so by the time the note is opened the editor can be handed markup
// that already points at real images — no async gap between the click and the
// caret appearing.
const imageUrls = new Map();

function urlFor(blob) {
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  return url;
}

// In-flight reads, so the same image wanted twice at once — by the board and
// by the Capture tray, say — resolves to one blob URL rather than two.
const imageReads = new Map();

/**
 * The blob URL for a stored image, minting one on first ask.
 * Resolves to null if the image is gone.
 */
export function imageUrlFor(id) {
  const known = imageUrls.get(id);
  if (known) return Promise.resolve(known);
  if (imageReads.has(id)) return imageReads.get(id);

  const read = getOne(IMAGES, id)
    .then((record) => {
      imageReads.delete(id);
      if (!record) return null;
      const url = urlFor(record.blob);
      imageUrls.set(id, url);
      return url;
    })
    .catch(() => {
      imageReads.delete(id);
      return null;
    });
  imageReads.set(id, read);
  return read;
}

function hydrateImages(body) {
  body.querySelectorAll("img[data-img-id]").forEach((img) => {
    const id = img.dataset.imgId;
    const known = imageUrls.get(id);
    if (known) {
      img.src = known; // synchronously, so a re-render never blinks
      return;
    }
    imageUrlFor(id).then((url) => {
      if (url) img.src = url;
    });
  });
}

// Markup is stored without src; the editor needs it back to show anything.
function withImageSrc(html) {
  if (!html || !html.includes("data-img-id")) return html;
  const holder = document.createElement("div");
  holder.innerHTML = html;
  holder.querySelectorAll("img[data-img-id]").forEach((img) => {
    const url = imageUrls.get(img.dataset.imgId);
    if (url) img.src = url;
  });
  return holder.innerHTML;
}

async function storeImage(blob) {
  const id = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await put(IMAGES, { id, blob }).catch(() => {});
  const url = urlFor(blob);
  imageUrls.set(id, url);
  return { id, url };
}

// `updatedAt` moves on every mutation because sync merges on it. `editedAt`
// only moves when the content changes, which is what the note footer shows.
// Formatting that can only have arrived by typing an input rule or using the
// selection bar. Checked here rather than hooked into the editor because the
// input rules live inside Tiptap; what is on the note is the honest evidence.
let sawFormatting = false;
const FORMATTED = /<(ul|ol|h[1-6]|blockquote|pre)\b|taskList/i;

export function saveNote(note) {
  if (note.deleted) return;
  if (!sawFormatting && FORMATTED.test(note.html || "")) {
    sawFormatting = true;
    markUsed("typing");
  }
  note.updatedAt = Date.now();
  write(note);
}

// Down to the database, and out to everywhere else the note is open. A host
// that does not own all of a note — a frame floating it, which owns its words
// but not where it is filed — says which fields to leave as they are stored.
function write(note) {
  const keep = host && host.keeps;
  if (!keep) {
    put(NOTES, note).catch(() => {});
    tell(note);
    return;
  }
  putKeeping(NOTES, note, keep)
    .then((written) => {
      keep.forEach((key) => {
        if (key in written) note[key] = written[key];
        else delete note[key];
      });
      tell(written);
    })
    .catch(() => {});
}

/**
 * Change some fields of a note that need not be open here, and tell everywhere
 * that it is. Tucking away every floating note from one of them is the case:
 * the rest are in frames of their own, on this page and on others.
 */
export function patchNote(id, fields) {
  return patch(NOTES, id, { ...fields, updatedAt: Date.now() })
    .then((written) => {
      if (written) {
        adoptRecord(written);
        tell(written);
      }
      return written;
    })
    .catch(() => null);
}

// Everywhere else this note is open — a frame floating it over a webpage,
// another tab's board — hears about the write straight away and takes it in
// (see adoptRecord). They all share this origin, so nothing has to carry it
// for them.
const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("easynote") : null;

function tell(note) {
  if (!channel) return;
  try {
    channel.postMessage({ type: "note", note });
  } catch (err) {
    // A record that will not clone is not one anybody else could have used.
  }
}

if (channel) {
  channel.onmessage = (e) => {
    if (e.data && e.data.type === "note") adoptRecord(e.data.note);
  };
}

/**
 * A note's markup as one line of readable text.
 *
 * Shared by search and the gallery, which both have to say which note they
 * are pointing at in the width of a row.
 */
export function plainText(html) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  div.querySelectorAll("img").forEach((img) => img.replaceWith("🖼 "));
  // Taking the tags out runs the blocks together — a heading above a list came
  // back as "Reading listContext switching studyFlameshot's…", which is
  // unreadable in a snippet and matches across a word boundary that was never
  // there. Each block gets a space to sit behind.
  div
    .querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, div, blockquote, pre, br, tr")
    .forEach((el) => el.after(" "));
  return div.textContent.replace(/\s+/g, " ").trim();
}

/** The same wording the line under a note uses. */
export function whenLabel(note) {
  return formatDate(timestampOf(note));
}

function formatDate(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const min = 60000, hour = 3600000, day = 86400000;
  if (diff < min) return "just now";
  if (diff < hour) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Older notes predate editedAt; fall back to updatedAt, then to the timestamp
// embedded in ids minted before uuids.
export function timestampOf(note) {
  if (note.editedAt) return note.editedAt;
  if (note.updatedAt) return note.updatedAt;
  const parsed = parseInt(String(note.id).split("-")[0], 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function updateHint() {
  if (!hint) return;
  // A board holding an empty list is not an empty board — it is one somebody
  // has already started arranging, and telling them how to begin is noise.
  hint.style.display = notes.size || listCount() ? "none" : "block";
}

export function nextZ() {
  return ++zCounter;
}

export function seedZ(value) {
  zCounter = Math.max(zCounter, value);
}

/* ---------------------------------------------------------- privacy blur */

export function isBlurred() {
  return document.documentElement.classList.contains("blur-notes");
}

export function setBlurNotes(value, persist = true) {
  document.documentElement.classList.toggle("blur-notes", value);
  document.getElementById("toggle-blur").classList.toggle("is-active", value);
  document.getElementById("toggle-blur").title = value
    ? "Notes are blurred — click to reveal (Alt+B)"
    : "Blur notes for screen sharing (Alt+B)";
  if (!persist) return;
  // Mirrored synchronously so boot.js can blur before the first paint.
  try {
    localStorage.setItem("easynote:blurNotes", value ? "on" : "off");
  } catch (e) {
    /* ignore */
  }
  setPref("blurNotes", value);
}

function refreshDate(note, el) {
  const footer = el.querySelector(".note-edited");
  if (footer) footer.textContent = formatDate(timestampOf(note));
}

export function refreshAllDates() {
  notes.forEach(({ note, el }) => refreshDate(note, el));
}

// Drop clipboard content onto the canvas as a note of its own. Used by the
// canvas paste and by Ctrl+P; a note that arrives already full never sees the
// empty state, so it is filled before the first save.
//
// Unformatted, the markup and the pictures are both left behind — asked for as
// plain text, a clipboard is text and nothing else, the same as it is inside a
// note.
export async function createNoteWithContent(
  worldX,
  worldY,
  { html, text, blobs = [] } = {},
  { formatted = true } = {}
) {
  const { note, el } = createNote(worldX, worldY);
  // createNote activates the note, so the editor is already on it. Going in
  // through the editor means the clipboard is read by the same parser that
  // handles a paste into an open note: markup the schema does not know is
  // dropped rather than turned into a run of blank lines.
  const editor = editorFor(note.id);
  if (!editor) return { note, el };

  if (formatted && html) editor.commands.setContent(html);
  else if (text) editor.commands.setContent(textToHtml(text));

  if (formatted) for (const blob of blobs) insertImage(editor, await storeImage(blob));

  touch(note, el, cleanHtml(editor.getHTML()));
  return { note, el };
}

// When the clipboard will not be read, this is what is left: open a note at the
// point and ask the document to paste into it, which puts the clipboard through
// the editor's own ⌘V handling. The note stays either way — an empty one open
// at the cursor is still somewhere to paste into by hand.
export function createNoteAndPasteByCommand(worldX, worldY) {
  const { note, el } = createNote(worldX, worldY);
  const editor = editorFor(note.id);
  if (!editor) return false;
  editor.commands.focus();
  if (!pasteByCommand()) return false;
  touch(note, el, cleanHtml(editor.getHTML()));
  return true;
}

// Plain text arrives as lines, not as markup. Each becomes a paragraph, with
// any bare address in it turned into a link on the way — nothing else will,
// since autolinking only happens as you type.
function textToHtml(text) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const p = document.createElement("p");
      p.appendChild(linkifyText(line));
      return p.outerHTML;
    })
    .join("");
}

/* --------------------------------------------------- copying whole notes */

// What a copy of a note carries. Not the id, which the paste mints fresh, and
// not the page or the list it sat in — a pasted note lands on the board you are
// looking at. Position rides along so that copying four notes and pasting them
// gives you the same arrangement, not a stack.
//
// Pictures travel as the ids they are stored under. Pasted back into Easy Note
// they resolve against the same image store and the picture is simply there;
// pasted into anything else, the words survive and the pictures do not.
function noteRecord(note) {
  const copy = {
    x: note.x,
    y: note.y,
    width: note.width,
    height: note.height,
    html: note.html || "",
    color: note.color,
  };
  if (note.app) {
    copy.app = note.app;
    // A copy of the state, not the state: a running timer keeps writing to its
    // own, and a clipboard holding the same object would paste whatever it says
    // at the moment of pasting rather than at the moment of copying.
    copy.state = note.state ? JSON.parse(JSON.stringify(note.state)) : null;
  }
  return copy;
}

/**
 * Put notes on the clipboard, whole.
 *
 * @returns how many made it — 0 if the clipboard refused to be written to,
 *          which is the caller's cue to say so rather than to delete anything.
 */
export async function copyNotes(entries) {
  const list = (entries || []).filter(Boolean);
  if (!list.length) return 0;
  const records = list.map(({ note }) => noteRecord(note));
  const text = records.map((r) => plainText(r.html)).filter(Boolean).join("\n\n");
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([encodeNotes(records)], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
  } catch (err) {
    return 0;
  }
  return list.length;
}

/** Copy, then delete what was copied. Locked notes are copied but stay put. */
export async function cutNotes(entries) {
  const copied = await copyNotes(entries);
  if (!copied) {
    toast("Could not copy to the clipboard");
    return 0;
  }
  entries.forEach(({ note, el }) => deleteNote(note, el));
  return copied;
}

/**
 * Put copied notes back on the board, with their top-left corner at the point.
 *
 * The whole group is offset together, so however many notes were copied they
 * arrive laid out the way they were left. Nothing is opened for typing: a paste
 * of six notes has no one note to put the caret in, and one of one is easier to
 * click into than to click out of.
 *
 * @returns the entries made, so the caller can select them
 */
export function pasteNoteRecords(records, worldX, worldY) {
  const list = (records || []).filter((r) => r && typeof r === "object");
  if (!list.length) return [];

  const originX = Math.min(...list.map((r) => Number(r.x) || 0));
  const originY = Math.min(...list.map((r) => Number(r.y) || 0));
  // The batch lands by its top-left corner, so keeping that inside the origin
  // keeps all of it inside.
  ({ x: worldX, y: worldY } = inBounds(worldX, worldY));

  const made = list.map((r) => {
    const note = {
      id: newId(),
      x: worldX + ((Number(r.x) || 0) - originX),
      y: worldY + ((Number(r.y) || 0) - originY),
      width: Number(r.width) || 200,
      height: Number(r.height) || 150,
      html: typeof r.html === "string" ? r.html : "",
      color: r.color || NO_FILL,
      z: nextZ(),
      createdAt: Date.now(),
      editedAt: Date.now(),
      updatedAt: Date.now(),
      pageId: currentPageId,
    };
    if (r.app) {
      note.app = r.app;
      if (r.state) note.state = r.state;
    }
    renderNote(note);
    saveNote(note);
    return note;
  });

  updateHint();
  record(pasteStep(made));
  return made.map((note) => notes.get(note.id)).filter(Boolean);
}

function pasteStep(batch) {
  return {
    kind: "create",
    noteId: batch.length === 1 ? batch[0].id : null,
    label: batch.length === 1 ? "the pasted note" : `the ${batch.length} pasted notes`,
    undo: () =>
      batch.forEach((note) => {
        const entry = notes.get(note.id);
        if (entry) deleteNote(note, entry.el, { silent: true });
      }),
    redo: () => restoreNotes(batch),
  };
}

/** The note records on the clipboard, or null if it is holding something else. */
export function notesOnClipboard(content) {
  return content ? decodeNotes(content.html) : null;
}

function touch(note, el, html) {
  note.html = html;
  note.editedAt = Date.now();
  saveNote(note);
  refreshDate(note, el);
}

/* -------------------------------------------------------------------- apps */

// A note whose `app` field names a renderer hands its body over to that
// renderer. Everything else about it — where it is, what colour, which list —
// is unchanged, because an app is a way of drawing a note and not a second
// kind of thing on the board.

function mountAppOn(entry) {
  const { note, el } = entry;
  if (!appFor(note.app)) return;
  const body = el.querySelector(".note-body");
  body.innerHTML = "";
  body.classList.add("is-app");
  entry.app = mountApp(body, note, { save: saveNote });
}

function unmountApp(entry) {
  if (!entry || !entry.app) return;
  entry.app.unmount();
  entry.app = null;
}

/** Everything that turning a note into an app changes, in one object. */
function appShapeOf(note) {
  return {
    app: note.app || null,
    // A copy: the live state keeps being written to, and a step holding the
    // same object would undo to whatever the timer says now.
    state: note.state ? JSON.parse(JSON.stringify(note.state)) : null,
    html: note.html || "",
    width: note.width,
    height: note.height,
  };
}

function applyAppShape(note, shape) {
  const entry = reviveNote(note);
  if (!entry) return;
  unmountEditor(entry);
  unmountApp(entry);

  if (shape.app) {
    note.app = shape.app;
    if (shape.state) note.state = shape.state;
    else delete note.state;
  } else {
    delete note.app;
    delete note.state;
  }
  note.html = shape.html || "";
  applyBox(note, { width: shape.width, height: shape.height });

  const body = entry.el.querySelector(".note-body");
  body.innerHTML = "";
  body.classList.toggle("is-app", !!note.app);
  if (note.app) mountAppOn(entry);
  else {
    body.innerHTML = note.html;
    hydrateImages(body);
  }
  saveNote(note);
}

function appStep(note, before, after) {
  return {
    kind: "app",
    noteId: note.id,
    label: after.app ? `the ${after.app}` : "the note",
    undo: () => applyAppShape(note, before),
    redo: () => applyAppShape(note, after),
  };
}

// Becoming an app takes the app's preferred size, once. After that the note is
// resized like any other and nothing reaches in to correct it.
function becomeApp(note, el, app, { keepText = true } = {}) {
  const before = appShapeOf(note);
  applyAppShape(note, {
    app: app.name,
    state: null, // seeded from the app's own init on mount
    html: keepText ? note.html || "" : "",
    width: app.size ? app.size.width : note.width,
    height: app.size ? app.size.height : note.height,
  });
  record(appStep(note, before, appShapeOf(note)));
}

function unbecomeApp(note, el) {
  const before = appShapeOf(note);
  applyAppShape(note, { ...before, app: null, state: null });
  record(appStep(note, before, appShapeOf(note)));
}

// Typing [timer] into a note and leaving it is the shortcut to the menu item.
// It is read on the way out rather than as it is typed: mid-word the note says
// "[time", and a note is not something that should change shape under the
// caret. The words go with it — the keyword was the instruction, not content.
function convertIfKeyword(entry) {
  const { note, el } = entry;
  if (note.app) return;
  const app = appForKeyword(plainText(note.html));
  if (!app) return;
  becomeApp(note, el, app, { keepText: false });
}

/* ---------------------------------------------------------- slash commands */

// What "/" offers, narrowed by what has been typed after it: an app answers to
// its name, its title, or any of its keywords.
function appsMatching(query) {
  const q = String(query || "").toLowerCase();
  return allApps().filter((app) =>
    [app.name, app.title, ...(app.keywords || [])].some((word) => String(word).toLowerCase().startsWith(q))
  );
}

// A slash command puts its app down on the board, just to the right of the
// note it was typed in, top edges level. The note keeps its words and its
// caret — the editor has already taken the "/timer" back out — so writing
// carries straight on. The new one hops once, so the eye finds it.
function addAppBeside(note, el, app) {
  // Beside the note on its board. A host with no board on screen — a note
  // floating over a webpage — has only the note's own place there to go by.
  const at = host.beside ? host.beside(note, el) : { x: note.x + note.width, y: note.y };
  const { x, y } = inBounds(Math.round(at.x + GRID), Math.round(at.y));
  const made = {
    id: newId(),
    x,
    y,
    width: app.size ? app.size.width : 200,
    height: app.size ? app.size.height : 150,
    html: "",
    color: NO_FILL,
    z: nextZ(),
    app: app.name,
    createdAt: Date.now(),
    editedAt: Date.now(),
    updatedAt: Date.now(),
    pageId: note.pageId || currentPageId,
  };
  // A host that shows notes somewhere other than a board puts one made here
  // wherever notes go there: made from a note floating over a webpage, it floats
  // beside it.
  if (host.spawn) {
    host.spawn(made, note);
    return;
  }
  // Made on the board either way, but only drawn by a host showing that board.
  if (host.owns && !host.owns(made)) {
    saveNote(made);
    return;
  }
  renderNote(made);
  saveNote(made);
  updateHint();
  record({ ...createStep(made), label: `the new ${app.title.toLowerCase()}` });
  const entry = notes.get(made.id);
  if (entry) hopNote(entry);
}

/* ----------------------------------------------------------------- colours */

// The colours as the note menu shows them: a row of dots at the top, picked in
// one click. Colouring was two steps — Colour…, then a popover — for the thing
// people do to a note most after writing in it.
function colourSwatches(current) {
  return COLORS.map((color) => ({
    value: color,
    title: color === NO_FILL ? "No fill" : color,
    background: color === NO_FILL ? "" : color,
    clear: color === NO_FILL,
    current: color === (current || NO_FILL),
  }));
}

/* ------------------------------------------------------------- reminders */

let openMenu = null;

function closeReminderMenu() {
  if (!openMenu) return;
  openMenu.remove();
  openMenu = null;
}

function setReminder(note, el, at) {
  if (at) askToNotify(); // first, while the click that set it still counts
  if (at) markUsed("reminder");
  if (at) note.remindAt = at;
  else delete note.remindAt;
  saveNote(note); // a reminder is not an edit, so editedAt stays put
  trackReminder(note);
  refreshReminder(note, el);
}

/**
 * Put a popover at a point, nudged back on screen if it would hang off.
 * `at` is a plain {left, top} in viewport coordinates — the place the menu
 * that opened it was, since these no longer hang off a button of their own.
 */
function place(popover, at) {
  const rect = { left: at.left, top: at.top, bottom: at.top };
  popover.style.left = `${rect.left}px`;
  popover.style.top = `${rect.bottom + 6}px`;
  document.body.appendChild(popover);
  requestAnimationFrame(() => {
    const box = popover.getBoundingClientRect();
    if (box.right > window.innerWidth - 8) {
      popover.style.left = `${window.innerWidth - box.width - 8}px`;
    }
    if (box.bottom > window.innerHeight - 8) {
      popover.style.top = `${Math.max(8, rect.top - box.height - 6)}px`;
    }
  });
}

function showReminderMenu(at, note, el) {
  closeReminderMenu();
  const menu = document.createElement("div");
  menu.className = "remind-menu";

  const row = (label, onPick, className = "") => {
    const item = document.createElement("button");
    item.className = `remind-item ${className}`.trim();
    item.textContent = label;
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      onPick();
    });
    menu.appendChild(item);
    return item;
  };

  PRESETS.forEach((preset) =>
    row(preset.label, () => {
      setReminder(note, el, Date.now() + preset.ms);
      closeReminderMenu();
    })
  );

  row("Pick a time…", () => {
    menu.textContent = "";
    const input = document.createElement("input");
    input.type = "datetime-local";
    input.className = "remind-when";
    input.value = defaultCustomTime();
    const set = document.createElement("button");
    set.className = "remind-item is-primary";
    set.textContent = "Set reminder";
    const apply = () => {
      const at = new Date(input.value).getTime();
      if (Number.isFinite(at)) setReminder(note, el, at);
      closeReminderMenu();
    };
    set.addEventListener("click", (e) => {
      e.stopPropagation();
      apply();
    });
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") apply();
      if (e.key === "Escape") closeReminderMenu();
    });
    menu.append(input, set);
    input.focus();
  });

  if (note.remindAt) {
    row(
      "Clear reminder",
      () => {
        setReminder(note, el, null);
        closeReminderMenu();
      },
      "is-clear"
    );
  }

  place(menu, at);
  openMenu = menu;
}

document.addEventListener("pointerdown", (e) => {
  if (openMenu && !e.target.closest(".remind-menu") && !e.target.closest(".ctx-menu")) {
    closeReminderMenu();
  }
});

// Both halves of the line under a note: when it was last touched, and what it
// is waiting for.
function refreshReminder(note, el) {
  const chip = el.querySelector(".note-remind");
  if (!chip) return;
  const due = isDue(note);
  el.classList.toggle("is-due", due);
  // The hop runs once. Falling due again — a new reminder, a fresh render —
  // is what earns another one.
  if (!due) el.classList.remove("has-hopped");
  el.classList.toggle("has-reminder", !!note.remindAt);
  chip.hidden = !note.remindAt;
  chip.textContent = note.remindAt ? `🔔 ${remindLabel(note.remindAt)}` : "";
  chip.title = due
    ? "Reminder due — click to dismiss"
    : note.remindAt
      ? `Reminder ${remindLabel(note.remindAt)} — click to dismiss`
      : "";
}

export function refreshAllReminders() {
  notes.forEach(({ note, el }) => refreshReminder(note, el));
}

onReminderTick(refreshAllReminders);

/* -------------------------------------------------------------- fullscreen */

export function isFullscreen() {
  return !!fullscreenEntry;
}

export function enterFullscreen(note, el) {
  if (fullscreenEntry) exitFullscreen();
  fullscreenEntry = {
    note,
    el,
    style: { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height },
  };
  note.fullscreen = true;
  el.classList.add("is-fullscreen");
  el.style.left = "";
  el.style.top = "";
  el.style.width = "";
  el.style.height = "";
  overlay.classList.add("is-active");
  overlay.appendChild(el);
  setActiveNote(note.id);
  focusEditor(note.id);
}

export function exitFullscreen() {
  if (!fullscreenEntry) return;
  const { note, el, style } = fullscreenEntry;
  el.classList.remove("is-fullscreen");
  el.style.left = style.left;
  el.style.top = style.top;
  el.style.width = style.width;
  el.style.height = style.height;
  host.putBack(note, el);
  overlay.classList.remove("is-active");
  note.fullscreen = false;
  fullscreenEntry = null;
}

// Only the board has an overlay; a note in a frame of its own has nowhere
// bigger to go.
overlay?.addEventListener("pointerdown", (e) => {
  if (e.target === overlay) exitFullscreen();
});

/**
 * Close whatever Escape should close inside a note, innermost first.
 *
 * Exported rather than handled here so that Escape has one ladder in one
 * place: main.js owns the key and walks down it, ending at the board's own
 * rungs. Two independent listeners could not agree on who had already
 * consumed the press.
 *
 * @returns true if something was dismissed.
 */
export function dismissTopmost() {
  if (openMenu) {
    closeReminderMenu();
    return true;
  }
  if (fullscreenEntry) {
    const { note } = fullscreenEntry;
    exitFullscreen();
    // Escape only ends fullscreen here — the note is still open underneath it,
    // and a second Escape is what leaves editing. But putBack just reparented
    // the editor out of the overlay, which silently drops real DOM focus even
    // though the note still looks and behaves as active: anything typed next
    // would land nowhere, with no error and nothing to undo. Put the caret
    // back so the first Escape only ever changes size, never what typing does.
    if (activeId === note.id) focusEditor(note.id);
    return true;
  }
  if (activeId) {
    // A floating note comes down first. Escape is the "put this away" key, and
    // the note being over everything is the outermost thing about it — closer
    // to hand than the caret inside it.
    const entry = notes.get(activeId);
    // A host with its own idea of putting a note away — over a webpage that is
    // tucking it to the side, not taking it off every page — has the last say.
    if (entry && host && host.dismiss) return host.dismiss(entry.note, entry.el);
    if (entry && entry.note.floating) {
      clearActiveNote();
      unfloatNote(entry.note, entry.el);
      return true;
    }
    clearActiveNote(); // step out of the note you were writing in
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------- notes */

export function newId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createNote(worldX, worldY) {
  ({ x: worldX, y: worldY } = inBounds(worldX, worldY));
  const note = {
    // uuid, so ids minted on different devices can never collide.
    id: newId(),
    x: worldX,
    y: worldY,
    width: 200,
    height: 150,
    html: "",
    color: NO_FILL,
    z: nextZ(),
    createdAt: Date.now(),
    editedAt: Date.now(),
    updatedAt: Date.now(),
    pageId: currentPageId,
  };
  const el = renderNote(note);
  saveNote(note);
  updateHint();
  setActiveNote(note.id);
  focusEditor(note.id);
  record(createStep(note));
  return { note, el };
}

// Deletion writes a tombstone rather than removing the record. Without one,
// a delete cannot propagate and the note simply reappears from another device
// on the next sync. Images are kept until the tombstone is purged, since the
// note may still exist elsewhere.
export function deleteNote(note, el, { silent = false } = {}) {
  if (fullscreenEntry && fullscreenEntry.note === note) exitFullscreen();
  // Deleting it ends its floating too — including on every page it is floating
  // over right now.
  forgetFloating(note);

  destroyEditor(notes.get(note.id));
  unmountApp(notes.get(note.id));
  if (el.__observer) el.__observer.disconnect();
  el.remove();
  notes.delete(note.id);
  forgetSelection(note.id);
  if (activeId === note.id) activeId = null;

  note.deleted = true;
  note.deletedAt = Date.now();
  note.updatedAt = Date.now();
  write(note);
  trackReminder(note);

  updateHint();
  // A card that left its list still counted towards it until the next render.
  refreshList(note.listId);
  if (!silent) rememberForUndo(note);
  return true;
}

// An empty note is a note you decided against. Leaving one behind — never
// typing into a fresh one, or clearing out an old one and walking away —
// removes it, so the canvas never fills up with blank squares. No undo is
// offered: there is nothing in it to bring back.
function discardIfEmpty({ note, el }) {
  if (note.fullscreen) return;
  // An app note says nothing and is not thereby blank — a timer with no words
  // in it is exactly what a timer looks like.
  if (note.app) return;
  const body = el.querySelector(".note-body");
  if (!body) return;
  if (body.textContent.trim() || body.querySelector("img")) return;
  // Thrown away for never having held anything, so the history of making it and
  // pushing it around goes with it — ⌘Z should reach past a note that left no
  // mark on the board. An edit that emptied it survives: that step holds the
  // words, and undoing it brings the note back to say them.
  forget((step) => step.noteId === note.id && step.kind !== "content");
  deleteNote(note, el, { silent: true });
}

/* -------------------------------------------------------------- undo */

// A bulk delete calls deleteNote once per note. Collecting them on a timeout
// of 0 lets the whole batch land before the toast is offered, so the user sees
// one "3 notes deleted" rather than three toasts racing each other — and gets
// one step to walk back rather than three.
let undoBatch = [];
let undoBatchTimer = null;

function rememberForUndo(note) {
  undoBatch.push(note);
  clearTimeout(undoBatchTimer);
  undoBatchTimer = setTimeout(() => {
    const batch = undoBatch;
    undoBatch = [];
    if (!batch.length) return;
    const what = batch.length === 1 ? "Note deleted" : `${batch.length} notes deleted`;
    offerUndo(what, record(deleteStep(batch)));
  }, 0);
}

// Bring a record back onto the board if it has left it. Undo runs backwards
// through steps that each assume their note is still there, and the cheapest
// way to keep that true is to make it true: undoing a move to a note you have
// since deleted should hand the note back, not fail quietly.
export function reviveNote(note) {
  const existing = notes.get(note.id);
  if (existing) return existing;
  if (note.pageId !== currentPageId) return null; // it belongs to a board we are not on
  delete note.deleted;
  delete note.deletedAt;
  note.updatedAt = Date.now();
  put(NOTES, note).catch(() => {});
  renderNote(note);
  updateHint();
  return notes.get(note.id) || null;
}

// Put a note back in a place, or at a size, the history remembers. Only the
// sides named are touched, so one shape of step covers both a move and a
// resize without either having to carry the other's numbers.
export function applyBox(note, box) {
  const entry = reviveNote(note);
  if (!entry) return;
  const { el } = entry;
  if (box.x !== undefined) {
    note.x = box.x;
    el.style.left = `${box.x}px`;
  }
  if (box.y !== undefined) {
    note.y = box.y;
    el.style.top = `${box.y}px`;
  }
  if (box.width !== undefined) {
    note.width = box.width;
    el.style.width = `${box.width}px`;
  }
  if (box.height !== undefined) {
    note.height = box.height;
    el.style.height = `${box.height}px`;
  }
  saveNote(note);
}

// Making a note is a step too: a stray double-click on the canvas should be
// answered by ⌘Z rather than by hunting for the delete in the note's menu.
function createStep(note) {
  return {
    kind: "create",
    noteId: note.id,
    label: "the new note",
    undo: () => {
      const entry = notes.get(note.id);
      if (entry) deleteNote(note, entry.el, { silent: true });
    },
    redo: () => reviveNote(note),
  };
}

function deleteStep(batch) {
  return {
    kind: "delete",
    noteId: batch.length === 1 ? batch[0].id : null,
    label: batch.length === 1 ? "the delete" : `the delete of ${batch.length} notes`,
    undo: () => restoreNotes(batch),
    redo: () =>
      batch.forEach((note) => {
        const entry = notes.get(note.id);
        if (entry) deleteNote(note, entry.el, { silent: true });
      }),
  };
}

/**
 * Record notes having been moved, given where each of them started.
 *
 * One step however many notes travelled — a drag of six, or a grid arrange of
 * twenty, is one thing that happened and takes one ⌘Z. Notes that did not
 * actually end up somewhere else are left out: a click that grazed into a
 * one-pixel move should not cost anything to walk back.
 *
 * @param {Array<{note: object, from: {x: number, y: number}}>} moves
 * @param {string} [label]  what to call it, if "the move" is not the words
 */
// `listMoves` are lists that went with the notes, as {list, from}. A group
// dragged together is one step, whatever it held.
export function recordMove(moves, label, listMoves = []) {
  const moved = ({ from, to }) => from.x !== to.x || from.y !== to.y;
  const real = moves.map(({ note, from }) => ({ note, from, to: { x: note.x, y: note.y } })).filter(moved);
  const realLists = listMoves.map(({ list, from }) => ({ list, from, to: { x: list.x, y: list.y } })).filter(moved);
  if (!real.length && !realLists.length) return;

  const count = real.length + realLists.length;
  const what = realLists.length
    ? `the move of ${count} things`
    : `the move of ${real.length} notes`;
  record({
    kind: "move",
    noteId: real.length === 1 && !realLists.length ? real[0].note.id : null,
    label: label || (count === 1 ? "the move" : what),
    undo: () => {
      real.forEach(({ note, from }) => applyBox(note, from));
      realLists.forEach(({ list, from }) => placeList(list, from));
    },
    redo: () => {
      real.forEach(({ note, to }) => applyBox(note, to));
      realLists.forEach(({ list, to }) => placeList(list, to));
    },
  });
}

// One visit to a note is one step. The keystrokes inside it are Tiptap's own
// history to walk; what the board remembers is that you went in, and what the
// note said when you came back out.
function recordEdit(entry) {
  const before = entry.htmlAtMount || "";
  const after = entry.note.html || "";
  if (before === after) return;
  // An editor that arrived on an empty note arrived on a note that had just
  // been made, and the creation step already carries whatever was typed into
  // it. Recording both would charge two ⌘Z for one act.
  if (!before) return;
  record(editStep(entry.note, before, after));
}

/**
 * Take in a note's markup that was written somewhere else.
 *
 * A note can be open in more than one place at once — on the board, and in a
 * frame floating it over a webpage — so this copy of it can be a keystroke
 * behind, and an editor open on the note is holding the old document. Nothing
 * is recorded and nothing is written back: the edit has already happened and is
 * already saved, and charging a ⌘Z for someone else's keystrokes would be wrong.
 *
 * A note being typed into *here* is left alone. Two places cannot share one
 * caret, and the record is last-write-wins either way.
 */
export function adoptContent(note, html) {
  const entry = notes.get(note.id);
  if (!entry || typeof html !== "string" || note.html === html) return;
  const body = entry.el.querySelector(".note-body");
  if (body && body.contains(document.activeElement)) return;

  note.html = html;
  if (entry.editor) {
    // Through the editor, so its document and the stored markup stay in step,
    // and the baseline moves with it — otherwise leaving the note afterwards
    // records this as a fresh edit of the user's own.
    // Quietly: an update event here would save the markup straight back out,
    // and the two copies would start answering each other.
    entry.editor.commands.setContent(withImageSrc(html), { emitUpdate: false });
    entry.htmlAtMount = html;
  } else if (body) {
    body.innerHTML = html;
    hydrateImages(body);
  }
  refreshDate(note, entry.el);
}

/**
 * Take in a whole record written somewhere else.
 *
 * See saveNote: every write is heard by every other place the note is open.
 * The newest write wins, which is the rule sync merges by, and nothing here
 * writes anything back — the change has been saved by whoever made it.
 */
export function adoptRecord(record) {
  const entry = record && notes.get(record.id);
  if (!entry || (record.updatedAt || 0) <= (entry.note.updatedAt || 0)) return;
  const { note, el } = entry;

  if (record.deleted) {
    if (fullscreenEntry && fullscreenEntry.note === note) exitFullscreen();
    detachNote(entry);
    updateHint();
    if (host && host.adopted) host.adopted(record, null);
    return;
  }

  adoptContent(note, record.html);
  note.updatedAt = record.updatedAt;
  note.editedAt = record.editedAt;
  if ((note.color || NO_FILL) !== (record.color || NO_FILL)) {
    note.color = record.color;
    applyColor(note, el);
  }
  if (note.remindAt !== record.remindAt) {
    if (record.remindAt) note.remindAt = record.remindAt;
    else delete note.remindAt;
    trackReminder(note);
    refreshReminder(note, el);
  }
  // An app's state — a timer started in the other copy. Not while it is being
  // worked in here, for the same reason as the words.
  const shape = (n) => JSON.stringify([n.app || null, n.state || null]);
  if (shape(note) !== shape(record) && !isTyping(el)) {
    unmountApp(entry);
    if (record.app) {
      note.app = record.app;
      note.state = record.state;
    } else {
      delete note.app;
      delete note.state;
    }
    if (appFor(note.app)) {
      destroyEditor(entry);
      mountAppOn(entry);
    } else if (!entry.editor) {
      const body = el.querySelector(".note-body");
      body.classList.remove("is-app");
      body.innerHTML = note.html || "";
      hydrateImages(body);
    }
  }
  note.floating = !!record.floating;
  note.floatingGeometry = record.floatingGeometry || null;
  if (record.floatingTucked) note.floatingTucked = record.floatingTucked;
  else delete note.floatingTucked;
  refreshDate(note, el);
  if (host && host.adopted) host.adopted(note, el);
}

function editStep(note, before, after) {
  const apply = (html) => {
    const entry = reviveNote(note);
    if (!entry) return;
    if (entry.editor) {
      // Still open: going in through the editor keeps its document and the
      // stored markup in step, and moves the baseline with it so leaving the
      // note afterwards does not record the undo as a fresh edit.
      entry.editor.commands.setContent(withImageSrc(html));
      entry.htmlAtMount = html;
    } else {
      const body = entry.el.querySelector(".note-body");
      body.innerHTML = html;
      hydrateImages(body);
    }
    touch(note, entry.el, html);
  };

  return {
    kind: "content",
    noteId: note.id,
    label: "the edit",
    undo: () => apply(before),
    redo: () => apply(after),
  };
}

// The record was never removed, only flagged, so undo is just clearing the
// flag. updatedAt moves forward so the restore beats the tombstone already
// sitting on other devices.
export async function restoreNotes(batch) {
  for (const note of batch) {
    delete note.deleted;
    delete note.deletedAt;
    note.updatedAt = Date.now();
    await put(NOTES, note).catch(() => {});
    if (note.pageId === currentPageId && !notes.has(note.id)) renderNote(note);
  }
  updateHint();
}

// Tombstones only need to outlive the window in which another device might
// still be holding the note. Past that they are dead weight, and so are the
// images they reference.
export async function purgeTombstones(maxAgeMs = 30 * 24 * 3600 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  const all = await getAll(NOTES);
  // A tombstone with no timestamp — e.g. written by an older or third-party
  // client — must never be treated as infinitely old, or it is destroyed on
  // the next boot. No timestamp means keep.
  const doomed = all.filter((n) => {
    if (!n.deleted) return false;
    const at = n.deletedAt || n.updatedAt;
    return at ? at < cutoff : false;
  });
  if (!doomed.length) return 0;

  const live = all.filter((n) => !n.deleted);
  const stillReferenced = new Set(live.flatMap((n) => imageIdsIn(n.html)));
  const orphanImages = doomed
    .flatMap((n) => imageIdsIn(n.html))
    .filter((id) => !stillReferenced.has(id));

  await delMany(IMAGES, orphanImages).catch(() => {});
  await Promise.all(doomed.map((n) => del(NOTES, n.id).catch(() => {})));
  return doomed.length;
}

// Land on a note the way clicking it would: raised above its neighbours and
// ready to type into.
// The hop a note does when it comes due, done once on request — search uses
// it to say "this one", which is quicker to find than an outline, and works
// wherever on screen the note has ended up.
export function hopNote({ el }) {
  el.classList.remove("is-found");
  void el.offsetWidth; // let a second find of the same note hop again
  el.classList.add("is-found");
}

export function activateNote({ note, el }) {
  bringToFront(note, el);
  setActiveNote(note.id);
  focusEditor(note.id);
}

/* ----------------------------------------------------------------- editor */

// Mounted lazily. Activating a note shows its header; the editor only arrives
// when the body is about to be typed in. Mounting any earlier would tear the
// DOM out from under a click — a link on an idle note would stop opening.
export function editorFor(id) {
  const entry = notes.get(id);
  if (!entry) return null;
  if (entry.editor) return entry.editor;
  // An app owns its body. There is no text to put a caret in, and mounting the
  // editor over it would tear the app's own DOM out.
  if (entry.note.app) return null;

  const { note, el } = entry;
  const body = el.querySelector(".note-body");
  entry.editor = mountEditor(body, withImageSrc(note.html), {
    onChange: (html) => touch(note, el, html),
    commands: {
      items: appsMatching,
      onPick: (app) => addAppBeside(note, el, app),
    },
    onImages: async (files) => {
      for (const blob of files) insertImage(entry.editor, await storeImage(blob));
    },
  });
  // What the note said when the editor arrived, so leaving it can tell
  // whether this visit changed anything.
  entry.htmlAtMount = note.html || "";
  el.classList.add("is-editing");
  return entry.editor;
}

/**
 * Paste into the note the menu was opened from.
 *
 * ⌘V on an open note is ProseMirror's business and needs nothing from us. This
 * is the same thing asked for from the menu, where there is no paste event to
 * carry the clipboard — so it has to be read instead. The extension holds
 * `clipboardRead`, which is what lets that answer without a prompt; when it
 * comes back with nothing anyway there is still the command paste to try, and
 * failing that it says so rather than appearing to do nothing.
 */
async function pasteIntoNote(note, el, { formatted }) {
  const editor = editorFor(note.id); // the menu has already made this the active note
  if (!editor) return;

  const content = await readClipboard();
  if (!hasContent(content)) {
    // The clipboard came back empty, which also means "would not be read".
    // Asking the document to paste is the other door to it, and the editor
    // takes what comes through as if it had been ⌘V'd. Only the formatted
    // paste can go that way — a command paste brings the markup with it.
    if (formatted) {
      editor.commands.focus();
      if (pasteByCommand()) {
        markUsed("paste");
        touch(note, el, cleanHtml(editor.getHTML()));
        return;
      }
    }
    toast("Nothing on the clipboard to paste");
    return;
  }

  markUsed("paste");
  // Images are files, not markup, and are pasted only when the formatting is
  // wanted — asked for as plain text, a picture is not text at all.
  if (formatted) {
    for (const blob of content.blobs) insertImage(editor, await storeImage(blob));
  }
  pasteInto(editor, content, { formatted });
  touch(note, el, cleanHtml(editor.getHTML()));
}

/** A table in the note the menu was opened from. */
function addTable(note) {
  const editor = editorFor(note.id); // the menu has already made this the active note
  if (editor) insertTable(editor);
}

function focusEditor(id) {
  const editor = editorFor(id);
  if (editor) editor.commands.focus("end");
}

function destroyEditor(entry) {
  if (!entry || !entry.editor) return;
  entry.editor.destroy();
  entry.editor = null;
  entry.el.classList.remove("is-editing");
}

// Hand the body back as static markup. The stored html is the authority: an
// edit has already written it through onChange, and a note that was only
// looked at keeps exactly the markup it arrived with.
function unmountEditor(entry) {
  if (!entry || !entry.editor) return;
  recordEdit(entry);
  destroyEditor(entry);
  const body = entry.el.querySelector(".note-body");
  body.innerHTML = entry.note.html || "";
  hydrateImages(body);
}

/** Is the caret in this note right now? */
export function isTyping(el) {
  const active = document.activeElement;
  return !!active && active.isContentEditable && el.contains(active);
}

/* ----------------------------------------------------------------- active */

// One note at a time is "active" — the one last clicked. Its header appears;
// every other note keeps a clean, unbroken face. Being active is also what
// hands the body back to the caret: on an idle note a drag anywhere moves it.
let activeId = null;

export function setActiveNote(id) {
  if (activeId === id) return;
  const previous = notes.get(activeId);
  if (previous) {
    previous.el.classList.remove("is-active");
    // Tearing the editor down takes the caret with it. Clear the selection
    // first: left inside the note, Chrome hands focus straight back on the
    // mousedown that follows and the note springs back to life.
    const sel = window.getSelection();
    if (sel && sel.rangeCount && previous.el.contains(sel.anchorNode)) sel.removeAllRanges();
    unmountEditor(previous);
    convertIfKeyword(previous);
    discardIfEmpty(previous);
  }
  activeId = id || null;
  const next = notes.get(activeId);
  if (next) next.el.classList.add("is-active");
}

export function clearActiveNote() {
  setActiveNote(null);
}

export function bringToFront(note, el) {
  note.z = nextZ();
  el.style.zIndex = note.z;
}

// The header floats free of the note, so it borrows the note's colour to
// read as part of it. A note with no fill has none to lend, so the popover
// falls back to a neutral card — otherwise its buttons would hang in mid-air.
function applyColor(note, el) {
  const color = note.color || NO_FILL;
  const clear = color === NO_FILL;
  // An unfilled note gets no inline background at all, rather than an inline
  // `transparent`. Inline beats the stylesheet, and the stylesheet is what
  // gives a maximised unfilled note something to read against.
  el.style.background = clear ? "" : color;
  // The header popover borrows the note's colour so it reads as part of it.
  // An unfilled note has none to lend, so it takes the theme's surface —
  // a hardcoded cream would glow on a dark board.
  el.style.setProperty("--note-surface", clear ? "var(--surface)" : color);
  el.classList.toggle("is-clear", clear);
}

/* ------------------------------------------------------------------- host */

// A note is drawn by this module and put somewhere by a host. The board is one
// host: it places the note in world coordinates, files it into lists, selects
// it and carries it around. A note floating over a webpage is drawn by the very
// same renderNote into a frame of its own, and that frame is a host too. Keeping
// the where apart from the what is how a note learns something once and has it
// in both places.
//
// A host is { place, putBack, wire, gang, menu }:
//   place(note, el)        a freshly drawn note goes where it lives
//   putBack(note, el)      it comes back from fullscreen
//   wire(note, el, grip,   the gestures that move and size it there, grip at
//       gripLeft)          the bottom-right corner and gripLeft at the bottom-left
//   gang(note, el)         the entries a menu opened on it acts on
//   menu(note, el, gang)   { top, modes, together, copy }: top rows above the
//                          colours, extra rows below Fullscreen, rows for a
//                          group above Delete, and copy: false to leave
//                          "Copy note" off entirely
// and, optionally:
//   adopted(note, el)      a write made elsewhere has been taken in
//   beside(note, el)       where a note made from this one goes, in world units
//   owns(note)             whether a note made from this one is drawn here
//   spawn(made, from)      put a note made from this one where this host
//                          keeps notes, instead of on a board
//   dismiss(note, el)      Escape reached the open note; true if handled
//   keeps                  fields this host never writes: they are kept as
//                          the database has them, whatever its copy says
let host = null;

export function setNoteHost(next) {
  host = next;
}

export function renderNote(note) {
  const el = document.createElement("div");
  el.className = "note";
  el.dataset.id = note.id;

  const header = document.createElement("div");
  header.className = "note-header";

  const moreBtn = document.createElement("button");
  moreBtn.className = "note-btn note-btn-more";
  moreBtn.textContent = "⋯";
  moreBtn.title = "Note actions";

  header.append(moreBtn);

  const grip = document.createElement("div");
  grip.className = "note-grip";
  grip.title = "Drag to resize";

  // The same handle at the opposite bottom corner, so a note can be grown
  // toward either side rather than only down and to the right.
  const gripLeft = document.createElement("div");
  gripLeft.className = "note-grip note-grip-left";
  gripLeft.title = "Drag to resize";

  // Static markup until the note is opened; the editor takes the body over
  // then and hands it back on the way out.
  const body = document.createElement("div");
  body.className = "note-body";
  if (!appFor(note.app)) {
    body.innerHTML = note.html || "";
    hydrateImages(body);
  }

  // One line under the note, carrying three things: when it was last written
  // in, what it is waiting for, and a way to give it something to wait for.
  // It is there when your hand is — hovering or working in the note — and
  // otherwise only while a reminder is set, which is news worth keeping up.
  const footer = document.createElement("div");
  footer.className = "note-footer";

  const edited = document.createElement("span");
  edited.className = "note-edited";
  edited.textContent = formatDate(timestampOf(note));

  const remind = document.createElement("span");
  remind.className = "note-remind";
  remind.hidden = true;

  const remindAdd = document.createElement("button");
  remindAdd.className = "note-remind-add";
  remindAdd.textContent = "Remind me";
  remindAdd.title = "Set a reminder on this note";

  footer.append(edited, remind, remindAdd);

  el.append(header, body, footer, grip, gripLeft);
  notes.set(note.id, { note, el });
  host.place(note, el);

  // After the entry exists: an app is handed the note it stores itself in. A
  // note naming an app this build has never heard of — synced from a newer
  // version — is drawn as the ordinary note it also is, and its state rides
  // along untouched rather than being dropped on the next write.
  mountAppOn(notes.get(note.id));

  /* behaviour */

  // A checkbox is worth ticking without opening the note first — reading a
  // list and crossing something off is not editing. The static copy carries a
  // real input, so the click only has to be let through and written down.
  body.addEventListener("change", (e) => {
    const box = e.target.closest && e.target.closest('input[type="checkbox"]');
    if (!box) return;
    const entry = notes.get(note.id);
    if (!entry || entry.editor) return; // the editor owns its own checkboxes

    const item = box.closest("li");
    if (item) item.setAttribute("data-checked", box.checked ? "true" : "false");
    // The property moved, the attribute did not, and the attribute is what
    // gets serialised.
    if (box.checked) box.setAttribute("checked", "checked");
    else box.removeAttribute("checked");

    // Crossing something off without opening the note is still an edit to it,
    // and a box ticked by mistake is exactly the kind of thing ⌘Z is for.
    const before = note.html || "";
    touch(note, el, cleanHtml(body.innerHTML));
    record(editStep(note, before, note.html || ""));
  });

  // ⌘K is ours: the editor knows how to make a link, but not what to ask.
  body.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
    e.preventDefault();
    e.stopPropagation();
    const entry = notes.get(note.id);
    if (!entry || !entry.editor) return;
    promptForLink(body, linkAtCaret(entry.editor), (href) => applyLink(entry.editor, href));
  });

  body.addEventListener("pointerdown", () => bringToFront(note, el));

  el.addEventListener("animationend", (e) => {
    if (e.animationName !== "note-wiggle") return;
    el.classList.add("has-hopped");
    el.classList.remove("is-found");
  });

  // Everything a note can have done to it, in one place, opened by the ⋯ or
  // by right-clicking the note itself.
  function openNoteMenu(clientX, clientY) {
    setActiveNote(note.id);
    // Right-clicking one of several selected notes means all of them, where
    // there is such a thing as several — the same rule the drag follows.
    const gang = host.gang(note, el);
    const { top = [], modes = [], together = [], copy = true } = host.menu(note, el, gang);
    const many = gang.length > 1 ? `${gang.length} notes` : "note";
    // Like everything else here, a colour picked for one of a selection is for
    // all of it.
    const paint = (color) =>
      gang.forEach((g) => {
        g.note.color = color;
        applyColor(g.note, g.el);
        saveNote(g.note);
      });
    showMenu(
      [
        ...top,
        ...(top.length ? [null] : []),
        { swatches: colourSwatches(note.color), pick: paint },
        null,
        { label: "Paste", run: () => pasteIntoNote(note, el, { formatted: true }) },
        { label: "Paste without formatting", run: () => pasteIntoNote(note, el, { formatted: false }) },
        // Rows and columns are added and removed from the table itself, on
        // hover; this only has to get the first one into the note.
        ...(note.app ? [] : [{ label: "Table", run: () => addTable(note) }]),
        null,
        // Copy only. ⌘X still cuts; the menu does not need to say so twice. Not
        // offered at all where a host says there is nothing to copy it into —
        // a floating note has no other board to paste a copy onto.
        ...(copy ? [{ label: `Copy ${many}`, run: () => copyNotes(gang) }, null] : []),
        // Reminders are set from the note's own footer, and an app is made by
        // typing its name into a note. Only the way back out lives here.
        ...(note.app ? [{ label: "Turn back into a note", run: () => unbecomeApp(note, el) }, null] : []),
        { label: note.fullscreen ? "Exit fullscreen" : "Fullscreen", run: () => {
          if (note.fullscreen) exitFullscreen();
          else enterFullscreen(note, el);
        } },
        ...modes,
        null,
        ...together,
        { label: "Delete note", run: () => deleteNote(note, el), danger: true },
      ],
      clientX,
      clientY
    );
  }

  moreBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const r = moreBtn.getBoundingClientRect();
    openNoteMenu(r.left, r.bottom + 4);
  });

  el.addEventListener("contextmenu", (e) => {
    if (e.target.closest("a[href]")) return; // the browser's own link menu
    e.preventDefault();
    e.stopPropagation();
    openNoteMenu(e.clientX, e.clientY);
  });

  // The chip is the dismiss button. A note with a reminder always shows its
  // footer, so there is always something to press to make it stop.
  remind.addEventListener("pointerdown", (e) => e.stopPropagation());
  remind.addEventListener("click", (e) => {
    e.stopPropagation();
    setReminder(note, el, null);
  });

  // The same menu as ⋯ → Remind me…, one click nearer. It opens under the
  // button, where the eye already is.
  remindAdd.addEventListener("pointerdown", (e) => e.stopPropagation());
  remindAdd.addEventListener("click", (e) => {
    e.stopPropagation();
    const r = remindAdd.getBoundingClientRect();
    showReminderMenu({ left: r.left, top: r.bottom + 4 }, note, el);
  });

  header.addEventListener("dblclick", (e) => {
    if (e.target.closest(".note-btn")) return;
    if (note.fullscreen) exitFullscreen();
    else enterFullscreen(note, el);
  });

  // Capture phase: the header's own pointerdown stops propagation, so a
  // bubbling listener here would never see clicks on the drag handle.
  el.addEventListener(
    "pointerdown",
    (e) => {
      if (note.fullscreen || isPanGesture(e)) return; // a pan is not a click
      setActiveNote(note.id);
    },
    true
  );

  // Focus can arrive without a click — from search, or from a note just
  // created — and that counts as activating it too.
  body.addEventListener("focusin", () => setActiveNote(note.id));

  applyColor(note, el);
  refreshReminder(note, el);
  host.wire(note, el, grip, gripLeft);

  return el;
}

/* ------------------------------------------------------------------- boot */

// Take a note off the canvas without touching its record — used when it moves
// to another page, and when switching pages.
export function detachNote(entry) {
  destroyEditor(entry);
  unmountApp(entry);
  if (entry.el.__observer) entry.el.__observer.disconnect();
  entry.el.remove();
  notes.delete(entry.note.id);
  forgetSelection(entry.note.id);
  if (activeId === entry.note.id) activeId = null;
}

window.addEventListener("pagehide", () => {
  // Closing the tab is leaving too. The write may not outlive the page, in
  // which case the blank note is simply still there next time.
  clearActiveNote();
  // Unmounting an app flushes whatever it had not written down yet. A timer
  // adjusted a moment before the tab closed should still say so next time.
  [...notes.values()].forEach(unmountApp);
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls.clear();
});

setInterval(refreshAllDates, 60000);
