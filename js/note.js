import { NOTES, IMAGES, META, put, del, delMany, getOne, getAll } from "./db.js";
import { view, world, canvas, isPanGesture, screenToWorld, GRID } from "./view.js";
import { notes } from "./store.js";
import {
  isSelected,
  selectOnly,
  toggleSelect,
  selectedList,
  selected,
  forgetSelection,
} from "./selection.js";
import {
  currentPageId,
  setDraggedNotes,
  dropTargetAt,
  moveNotesToPage,
  notesInHand,
  switchPage,
} from "./pages.js";
import { setPref } from "./prefs.js";
import { offerUndo, hideUndo } from "./undo.js";
import { linkifyText, promptForLink } from "./richtext.js";
import { showMenu, closeMenu } from "./menu.js";
import { markUsed } from "./tips.js";
import { mountEditor, insertImage, caretAt, linkAtCaret, applyLink, cleanHtml } from "./editor.js";
import {
  PRESETS,
  isDue,
  remindLabel,
  trackReminder,
  onReminderTick,
  defaultCustomTime,
  loadReminders,
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
const dragLayer = document.getElementById("drag-layer");
const hint = document.getElementById("hint");

export { notes };

const objectUrls = new Set();
let zCounter = 1;
let showDates = false;
let fullscreenEntry = null;

/* ----------------------------------------------------------------- helpers */

function escapeHtml(text) {
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
function saveNote(note) {
  if (note.deleted) return;
  note.updatedAt = Date.now();
  put(NOTES, note).catch(() => {});
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
function timestampOf(note) {
  if (note.editedAt) return note.editedAt;
  if (note.updatedAt) return note.updatedAt;
  const parsed = parseInt(String(note.id).split("-")[0], 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function updateHint() {
  hint.style.display = notes.size ? "none" : "block";
}

export function nextZ() {
  return ++zCounter;
}

export function seedZ(value) {
  zCounter = Math.max(zCounter, value);
}

/* ------------------------------------------------------------------ dates */

export function setShowDates(value, persist = true) {
  showDates = value;
  document.body.classList.toggle("show-dates", showDates);
  document.getElementById("toggle-dates").classList.toggle("is-active", showDates);
  notes.forEach(({ note, el }) => refreshDate(note, el));
  if (persist) setPref("showDates", showDates);
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
export async function createNoteWithContent(worldX, worldY, { html, text, blobs = [] } = {}) {
  const { note, el } = createNote(worldX, worldY);
  // createNote activates the note, so the editor is already on it. Going in
  // through the editor means the clipboard is read by the same parser that
  // handles a paste into an open note: markup the schema does not know is
  // dropped rather than turned into a run of blank lines.
  const editor = editorFor(note.id);
  if (!editor) return { note, el };

  if (html) editor.commands.setContent(html);
  else if (text) editor.commands.setContent(textToHtml(text));

  for (const blob of blobs) insertImage(editor, await storeImage(blob));

  touch(note, el, cleanHtml(editor.getHTML()));
  return { note, el };
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

function touch(note, el, html) {
  note.html = html;
  note.editedAt = Date.now();
  saveNote(note);
  refreshDate(note, el);
}

/* ----------------------------------------------------------------- colours */

let openPalette = null;

function closePalette() {
  if (!openPalette) return;
  openPalette.remove();
  openPalette = null;
}

function showPalette(at, note, el) {
  closePalette();
  const palette = document.createElement("div");
  palette.className = "palette";
  COLORS.forEach((color) => {
    const dot = document.createElement("button");
    dot.className = "palette-dot";
    if (color === NO_FILL) {
      dot.classList.add("is-clear");
      dot.title = "No fill";
    } else {
      dot.style.background = color;
      dot.title = color;
    }
    if (color === (note.color || NO_FILL)) dot.classList.add("is-current");
    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      note.color = color;
      if (color !== NO_FILL) markUsed("colour");
      applyColor(note, el);
      saveNote(note);
      closePalette();
    });
    palette.appendChild(dot);
  });

  // Fixed position: a popover inside .note would be clipped by overflow:hidden.
  place(palette, at);
  openPalette = palette;
}

document.addEventListener("pointerdown", (e) => {
  if (openPalette && !e.target.closest(".palette") && !e.target.closest(".ctx-menu")) {
    closePalette();
  }
});

/* ------------------------------------------------------------- reminders */

let openMenu = null;

function closeReminderMenu() {
  if (!openMenu) return;
  openMenu.remove();
  openMenu = null;
}

function setReminder(note, el, at) {
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
  markUsed("fullscreen");
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
  world.appendChild(el);
  overlay.classList.remove("is-active");
  note.fullscreen = false;
  fullscreenEntry = null;
}

overlay.addEventListener("pointerdown", (e) => {
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
  if (openPalette) {
    closePalette();
    return true;
  }
  if (openMenu) {
    closeReminderMenu();
    return true;
  }
  if (fullscreenEntry) {
    exitFullscreen();
    return true;
  }
  if (activeId) {
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
    locked: false,
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
  return { note, el };
}

// Deletion writes a tombstone rather than removing the record. Without one,
// a delete cannot propagate and the note simply reappears from another device
// on the next sync. Images are kept until the tombstone is purged, since the
// note may still exist elsewhere.
export function deleteNote(note, el, { silent = false } = {}) {
  if (note.locked) return false;
  if (fullscreenEntry && fullscreenEntry.note === note) exitFullscreen();

  destroyEditor(notes.get(note.id));
  if (el.__observer) el.__observer.disconnect();
  el.remove();
  notes.delete(note.id);
  forgetSelection(note.id);
  if (activeId === note.id) activeId = null;

  note.deleted = true;
  note.deletedAt = Date.now();
  note.updatedAt = Date.now();
  put(NOTES, note).catch(() => {});
  trackReminder(note);

  updateHint();
  if (!silent) rememberForUndo(note);
  return true;
}

// An empty note is a note you decided against. Leaving one behind — never
// typing into a fresh one, or clearing out an old one and walking away —
// removes it, so the canvas never fills up with blank squares. No undo is
// offered: there is nothing in it to bring back.
function discardIfEmpty({ note, el }) {
  if (note.locked || note.fullscreen) return;
  const body = el.querySelector(".note-body");
  if (!body) return;
  if (body.textContent.trim() || body.querySelector("img")) return;
  deleteNote(note, el, { silent: true });
}

/* -------------------------------------------------------------- undo */

// A bulk delete calls deleteNote once per note. Collecting them on a timeout
// of 0 lets the whole batch land before the toast is offered, so the user sees
// one "3 notes deleted" rather than three toasts racing each other.
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
    offerUndo(what, () => restoreNotes(batch));
  }, 0);
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

  const { note, el } = entry;
  const body = el.querySelector(".note-body");
  entry.editor = mountEditor(body, withImageSrc(note.html), {
    onChange: (html) => touch(note, el, html),
    onImages: async (files) => {
      for (const blob of files) insertImage(entry.editor, await storeImage(blob));
    },
  });
  el.classList.add("is-editing");
  return entry.editor;
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
  destroyEditor(entry);
  const body = entry.el.querySelector(".note-body");
  body.innerHTML = entry.note.html || "";
  hydrateImages(body);
}

/** Is the caret in this note right now? */
function isTyping(el) {
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
    discardIfEmpty(previous);
  }
  activeId = id || null;
  const next = notes.get(activeId);
  if (next) next.el.classList.add("is-active");
}

export function clearActiveNote() {
  setActiveNote(null);
}

function bringToFront(note, el) {
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

function applyLockUI(note, el) {
  el.classList.toggle("is-locked", !!note.locked);
  const mark = el.querySelector(".note-lock-mark");
  if (mark) {
    mark.hidden = !note.locked;
    mark.title = "Locked — pinned in place and safe from deletion";
  }
}

export function renderNote(note) {
  const el = document.createElement("div");
  el.className = "note";
  el.style.left = `${note.x}px`;
  el.style.top = `${note.y}px`;
  el.style.width = `${note.width}px`;
  el.style.height = `${note.height}px`;
  el.style.zIndex = note.z;
  el.dataset.id = note.id;

  const header = document.createElement("div");
  header.className = "note-header";

  const left = document.createElement("div");
  left.className = "note-tools";

  // The lock is the one state worth seeing without asking for it — a note that
  // will not move or delete should say so. Everything else is in the menu.
  const lockMark = document.createElement("span");
  lockMark.className = "note-lock-mark";
  lockMark.textContent = "🔒";
  lockMark.hidden = true;

  const moreBtn = document.createElement("button");
  moreBtn.className = "note-btn note-btn-more";
  moreBtn.textContent = "⋯";
  moreBtn.title = "Note actions";

  left.append(lockMark);
  header.append(left, moreBtn);

  const grip = document.createElement("div");
  grip.className = "note-grip";
  grip.title = "Drag to resize";

  // Static markup until the note is opened; the editor takes the body over
  // then and hands it back on the way out.
  const body = document.createElement("div");
  body.className = "note-body";
  body.innerHTML = note.html || "";
  hydrateImages(body);

  // One line under the note, carrying two separate things: when it was last
  // written in, and what it is waiting for.
  const date = document.createElement("div");
  date.className = "note-date";

  const edited = document.createElement("span");
  edited.className = "note-edited";
  edited.textContent = formatDate(timestampOf(note));

  const remind = document.createElement("span");
  remind.className = "note-remind";
  remind.hidden = true;

  date.append(edited, remind);

  el.append(header, body, date, grip);
  world.appendChild(el);

  notes.set(note.id, { note, el });

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

    touch(note, el, cleanHtml(body.innerHTML));
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
    if (e.animationName === "note-wiggle") el.classList.add("has-hopped");
  });

  // Everything a note can have done to it, in one place, opened by the ⋯ or
  // by right-clicking the note itself.
  function openNoteMenu(clientX, clientY) {
    setActiveNote(note.id);
    showMenu(
      [
        { label: "Colour…", run: () => showPalette({ left: clientX, top: clientY }, note, el) },
        { label: note.remindAt ? "Change reminder…" : "Remind me…", run: () => showReminderMenu({ left: clientX, top: clientY }, note, el) },
        null,
        { label: note.fullscreen ? "Exit fullscreen" : "Fullscreen", run: () => {
          if (note.fullscreen) exitFullscreen();
          else enterFullscreen(note, el);
        } },
        { label: note.locked ? "Unlock" : "Lock", run: () => {
          note.locked = !note.locked;
          applyLockUI(note, el);
          saveNote(note);
        } },
        null,
        { label: "Delete note", run: () => deleteNote(note, el), danger: true, disabled: !!note.locked },
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

  // The chip is the dismiss button. A note that has started wiggling shows one
  // whether or not the dates are on, so there is always something to press to
  // make it stop.
  remind.addEventListener("pointerdown", (e) => e.stopPropagation());
  remind.addEventListener("click", (e) => {
    e.stopPropagation();
    setReminder(note, el, null);
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
      // Shift adds to the selection. Cmd/Ctrl is left free: held during a
      // drag it steps the note across the grid instead.
      if (e.shiftKey) toggleSelect(note.id);
      else if (!isSelected(note.id)) selectOnly(note.id);
    },
    true
  );

  // Focus can arrive without a click — from search, or from a note just
  // created — and that counts as activating it too.
  body.addEventListener("focusin", () => setActiveNote(note.id));

  applyColor(note, el);
  refreshReminder(note, el);
  makeDraggable(el, note);
  makeResizable(el, note, grip);
  el.__observer = observeResize(el, note);

  applyLockUI(note, el);
  return el;
}

/* --------------------------------------------------------------- drag layer */

// While dragging, a note leaves #world for #drag-layer so it is not clipped by
// the canvas and floats above the sidebar. Position becomes screen-space, and
// the world's scale is reapplied per-note so its size does not jump.
function liftToDragLayer(entries, pointer) {
  const rect = canvas.getBoundingClientRect();
  entries.forEach((entry) => {
    const { note, el } = entry;
    const left = rect.left + view.x + note.x * view.zoom;
    const top = rect.top + view.y + note.y * view.zoom;
    el.style.transform = `scale(${view.zoom})`;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    // Where the note sits relative to the cursor, frozen at the moment it was
    // picked up. Once it is in hand the pointer carries it directly: spring-
    // loading a page swaps the view out from under the drag, and anything
    // deriving screen position from world coordinates would teleport.
    entry.grabX = left - pointer.x;
    entry.grabY = top - pointer.y;
    dragLayer.appendChild(el);
  });
}

function positionInDragLayer(entries, pointer) {
  entries.forEach(({ el, grabX, grabY }) => {
    el.style.left = `${pointer.x + grabX}px`;
    el.style.top = `${pointer.y + grabY}px`;
  });
}

// Where a note in hand currently is, in the world of whatever board is on
// screen now — which is not necessarily the board it was picked up from.
function worldPositionOf(el) {
  const at = screenToWorld(parseFloat(el.style.left) || 0, parseFloat(el.style.top) || 0);
  return { x: Math.round(at.x), y: Math.round(at.y) };
}

const overCanvas = (e) => {
  const r = canvas.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
};

function returnToWorld(entries) {
  entries.forEach(({ note, el }) => {
    el.style.transform = "";
    el.style.left = `${note.x}px`;
    el.style.top = `${note.y}px`;
    if (el.isConnected) world.appendChild(el);
  });
}

// A click that never became a drag opens the note and puts the caret where it
// landed. The pointerdown was cancelled to keep the drag available, so nothing
// does this on its own.
function placeCaret(id, x, y) {
  const editor = editorFor(id);
  if (editor) caretAt(editor, x, y);
}

function makeDraggable(el, note) {
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    // Space+drag pans the board from wherever the cursor is, note or not.
    if (isPanGesture(e)) return;
    // Buttons in the header must keep their click event: preventDefault() on
    // pointerdown suppresses the compatibility click that follows.
    if (e.target.closest(".note-btn")) return;
    if (note.fullscreen) return;

    // A tick box answers to the click itself; cancelling the pointerdown to
    // start a drag would swallow it.
    if (e.target.closest('input[type="checkbox"], label')) return;

    const inBody = !!e.target.closest(".note-body");
    // A note you are writing in has given its body to the caret: dragging
    // there selects text, and the header popover is the handle. Its margin
    // is still a handle too — the editor fills the body, so landing on the
    // body itself means the pointer is out in the padding, on no text at all.
    const onMargin = e.target.classList.contains("note-body");
    if (inBody && !onMargin && isTyping(el)) return;
    if (e.target.closest("a[href]")) return;

    e.preventDefault();
    e.stopPropagation(); // don't let the canvas start a pan or marquee
    bringToFront(note, el);

    const startX = e.clientX;
    const startY = e.clientY;
    // Where these notes live. Spring-loading can change the board under the
    // drag, so "the page they came from" has to be remembered, not read back
    // off currentPageId at the end.
    const homePageId = currentPageId;

    // Dragging any member of a multi-selection moves the whole group — bar
    // the locked ones, which stay exactly where they were put.
    const group =
      isSelected(note.id) && selected.size > 1
        ? selectedList()
        : [{ note, el }];
    const anchored = group
      .filter((entry) => !entry.note.locked)
      .map((entry) => ({
        ...entry,
        startLeft: entry.note.x,
        startTop: entry.note.y,
      }));

    let lifted = false;
    let moved = false;

    // Snapping steps by the note under the cursor, or by the first that can
    // actually move if that one is pinned.
    const lead = anchored.find((entry) => entry.note.id === note.id) || anchored[0];

    const onMove = (moveEvent) => {
      // Screen delta -> world delta.
      let dx = (moveEvent.clientX - startX) / view.zoom;
      let dy = (moveEvent.clientY - startY) / view.zoom;

      // Cmd/Ctrl steps across the grid you can see behind the notes. Read
      // live, so it can be pressed or let go mid-drag. A group snaps by the
      // note under the cursor and travels with it, keeping its own shape.
      if (lead && (moveEvent.metaKey || moveEvent.ctrlKey)) {
        dx = Math.round((lead.startLeft + dx) / GRID) * GRID - lead.startLeft;
        dy = Math.round((lead.startTop + dy) / GRID) * GRID - lead.startTop;
      }

      anchored.forEach((entry) => {
        entry.note.x = entry.startLeft + dx;
        entry.note.y = entry.startTop + dy;
      });

      if (!lifted && anchored.length && Math.hypot(dx * view.zoom, dy * view.zoom) > 3) {
        lifted = true;
        moved = true;
        // Only now is this a drag, so only now do the pages light up as drop
        // targets — a plain click on a note should not flash the sidebar.
        setDraggedNotes(anchored.map((entry) => entry.note.id));
        liftToDragLayer(anchored, { x: moveEvent.clientX, y: moveEvent.clientY });
      }

      if (lifted) {
        positionInDragLayer(anchored, { x: moveEvent.clientX, y: moveEvent.clientY });
      } else {
        anchored.forEach((entry) => {
          entry.el.style.left = `${entry.note.x}px`;
          entry.el.style.top = `${entry.note.y}px`;
        });
      }
    };

    const stopListening = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey, true);
    };

    // Put everything back exactly as it was found, including the board that
    // was on screen when the drag began. Used by Escape, and by dropping the
    // notes on the row of the page they already live on — "file these where
    // they already are" means nothing, and stranding them under the sidebar
    // is not what was meant by it.
    const revert = async () => {
      anchored.forEach((entry) => {
        entry.note.x = entry.startLeft;
        entry.note.y = entry.startTop;
      });
      if (currentPageId !== homePageId) await switchPage(homePageId);
      if (lifted) returnToWorld(anchored);
      setDraggedNotes(null); // last: the switch above needs them still in hand
      updateHint();
    };

    // Escape abandons the drag at any point, the same as everywhere else in
    // the app. Capture phase, so it beats the board's own Escape handler.
    const onKey = (keyEvent) => {
      if (keyEvent.key !== "Escape" || !moved) return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      stopListening();
      revert();
    };

    const onUp = async (upEvent) => {
      stopListening();

      if (!moved) {
        // A click, not a drag. Clicking the body is how you start writing.
        if (inBody) placeCaret(note.id, upEvent.clientX, upEvent.clientY);
        return;
      }

      const records = anchored.map((entry) => entry.note);
      const onRow = dropTargetAt(upEvent.clientX, upEvent.clientY);
      // Whether a page was sprung open mid-drag, leaving these notes hovering
      // over a board that is not their own.
      const sprung = currentPageId !== homePageId;

      // Back onto their own page: a change of mind, so treat it as one.
      if (onRow && onRow === homePageId) {
        await revert();
        return;
      }

      // Reading the drop target first: this also cancels a spring still
      // counting down, so letting go never opens a page a beat too late.
      setDraggedNotes(null);

      // Dropped on another page's row: they go to it unplaced, as they always
      // have. Their coordinates are left alone — a row says which page, not
      // where on it, and the sidebar is no place to read a position from.
      if (onRow) {
        await moveNotesToPage(records, onRow);
        if (onRow === currentPageId) returnToWorld(anchored);
        else anchored.forEach(detachNote);
        updateHint();
        loadReminders(); // they may be another page's business now
        return;
      }

      // Dropped on the board. If a page was sprung open, this is the whole
      // point of having opened it: they join that page exactly where they were
      // put, rather than arriving somewhere on it unseen.
      if (overCanvas(upEvent)) {
        if (sprung) {
          await moveNotesToPage(records, currentPageId);
          land(anchored);
          updateHint();
          loadReminders();
        } else {
          // An ordinary move on the board they came from. The coordinates
          // onMove computed are kept as they are, so grid snapping survives.
          if (lifted) returnToWorld(anchored);
          anchored.forEach((entry) => saveNote(entry.note));
        }
        return;
      }

      // Dropped on nothing — the sidebar's empty space, or off the window.
      if (sprung) {
        // They still belong to their own page, which is no longer on screen.
        anchored.forEach((entry) => saveNote(entry.note));
        anchored.forEach(detachNote);
        updateHint();
      } else {
        if (lifted) returnToWorld(anchored);
        anchored.forEach((entry) => saveNote(entry.note));
      }
    };

    // Put notes down on the board that is currently up, where they visibly
    // are — not where their old page's coordinates would have put them.
    function land(entries) {
      entries.forEach((entry) => {
        const at = worldPositionOf(entry.el);
        entry.note.x = at.x;
        entry.note.y = at.y;
      });
      returnToWorld(entries);
      entries.forEach((entry) => saveNote(entry.note));
    }

    // Window-level listeners rather than setPointerCapture: capture silently
    // failed to re-establish on repeat drags, stranding the note mid-gesture.
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey, true);
  });
}

// CSS `resize: both` was doing this, but it forces overflow:hidden on the
// note — which would clip the header popover against the note's own edge.
// Fifteen lines buys the popover its room, and a grip we can style.
function makeResizable(el, note, grip) {
  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || note.fullscreen) return;
    e.preventDefault();
    e.stopPropagation(); // not a drag of the note itself

    const startX = e.clientX;
    const startY = e.clientY;
    // Where these notes live. Spring-loading can change the board under the
    // drag, so "the page they came from" has to be remembered, not read back
    // off currentPageId at the end.
    const homePageId = currentPageId;
    const startW = el.offsetWidth;
    const startH = el.offsetHeight;

    const onMove = (m) => {
      // Screen delta -> world delta, as everywhere else on the canvas.
      el.style.width = `${startW + (m.clientX - startX) / view.zoom}px`;
      el.style.height = `${startH + (m.clientY - startY) / view.zoom}px`;
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      note.width = el.offsetWidth;
      note.height = el.offsetHeight;
      saveNote(note);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey, true);
  });
}

function observeResize(el, note) {
  const observer = new ResizeObserver(() => {
    // Removal fires this with a 0x0 box; fullscreen fires it with the viewport
    // size. Neither is a real resize of the note.
    if (note.deleted || note.fullscreen || !el.isConnected) return;
    note.width = el.offsetWidth;
    note.height = el.offsetHeight;
    saveNote(note);
  });
  observer.observe(el);
  return observer;
}

/* ------------------------------------------------------------------- boot */

// Take a note off the canvas without touching its record — used when it moves
// to another page, and when switching pages.
export function detachNote(entry) {
  destroyEditor(entry);
  if (entry.el.__observer) entry.el.__observer.disconnect();
  entry.el.remove();
  notes.delete(entry.note.id);
  forgetSelection(entry.note.id);
  if (activeId === entry.note.id) activeId = null;
}

export function clearBoard() {
  // Whatever is in hand stays there. Spring-loading rebuilds the board in the
  // middle of a drag, and detaching a note being carried would delete the
  // element under the cursor halfway through the gesture.
  const inHand = notesInHand();
  [...notes.values()]
    .filter((entry) => !inHand || !inHand.has(entry.note.id))
    .forEach(detachNote);
}

export function loadNote(record) {
  // v1 stored plain text under `text`; carry it over as escaped markup.
  if (record.html === undefined) record.html = escapeHtml(record.text || "");
  delete record.deleted;
  delete record.fullscreen;
  seedZ(record.z || 1);
  renderNote(record);
}

window.addEventListener("pagehide", () => {
  // Closing the tab is leaving too. The write may not outlive the page, in
  // which case the blank note is simply still there next time.
  clearActiveNote();
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls.clear();
});

setInterval(refreshAllDates, 60000);
