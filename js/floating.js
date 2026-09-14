// A note that floats.
//
// Floating is about the pages the user visits, not about the board. On the
// board a floating note is a note like any other — where it was left, at the
// size it was given, moving and zooming with everything else. All floating
// adds here is a mark saying that this note is also out there, over every page.
//
// That is deliberately much less than it was. An earlier build lifted the note
// out of the canvas into a fixed layer of its own while it floated, which bought
// two coordinate spaces, two drag implementations and an animation to get back
// down again — and what you actually want on your own board is your note where
// you put it. The floating part belongs on the webpage, where it is the whole
// point; on the board it only needs to be legible.

import { NOTES, getAll } from "./db.js";
import { notes } from "./store.js";
import { registerLayer } from "./board.js";
import { saveNote, adoptRecord } from "./note.js";
import { toast } from "./toast.js";

export const isFloating = (note) => !!note && !!note.floating;

// The whole of what floating looks like on the board. css/style.css gives the
// class a lift and a slow bob — enough to notice, not enough to watch.
export function markFloating(note, el) {
  el.classList.toggle("is-floating", !!note.floating);
  // On the page's clock rather than the note's. An animation starts when its
  // class goes on, so a note floated a minute after another would rise while
  // the other falls; starting each that far into its cycle keeps them together.
  // Set once per element — moving it on a bob already running would jump it.
  if (!note.floating) el.style.removeProperty("--afloat-sync");
  else if (!el.style.getPropertyValue("--afloat-sync")) {
    const now = document.timeline ? document.timeline.currentTime : performance.now();
    el.style.setProperty("--afloat-sync", `-${Math.round(now % AFLOAT_MS)}ms`);
  }
}

const AFLOAT_MS = 1500; // one pass of note-afloat in style.css

/**
 * Start floating.
 *
 * The host permission is asked for here rather than at install: a profile that
 * never floats a note never grants access to every page, which is the whole
 * reason the clipper gets by on `activeTab`. Asked from the click that wanted
 * it, because that is the only moment Chrome will allow the prompt.
 */
export async function floatNote(note, el) {
  if (note.floating) return;
  const granted = await requestPages();
  // A note that floats over no pages is not floating. There is nothing to be
  // half-granted here, so a refusal leaves the note exactly as it was.
  if (!granted) {
    toast("Floating notes need access to the pages you visit");
    return;
  }

  note.floating = true;
  delete note.floatingTucked; // floated again, it comes out where it can be seen
  // Left alone. The frame on a webpage is the first thing that knows how big
  // the viewport it has to sit in is, and it picks a place and clamps to it —
  // nothing here has a viewport worth guessing from.
  markFloating(note, el);
  saveNote(note);
  tellWorker();
}

/** Stop floating. The note has not moved, so there is nothing to put back. */
export function unfloatNote(note, el) {
  if (!note.floating) return;
  note.floating = false;
  delete note.floatingTucked;
  // floatingGeometry is kept, not cleared: floating it again should put it back
  // where it was on screen, and the record is the only memory of where that is.
  markFloating(note, el);
  saveNote(note);
  tellWorker();
}

/**
 * Tell the worker that a note has started floating without passing through
 * floatNote — made already floating, out on a webpage — so every open page
 * gets a frame for it.
 */
export function announceFloating() {
  tellWorker();
}

/** Float it, or stop — whichever it is not. The one thing the menu needs. */
export function toggleFloating(note, el) {
  if (note.floating) unfloatNote(note, el);
  else floatNote(note, el);
}

/**
 * A floating note is being deleted.
 *
 * Floating has to end with it, and not only so its frames go away: undo hands
 * the record back exactly as it was, and a note that came back still marked
 * floating would be a note quietly out on every page with nothing on the board
 * saying so.
 */
export function forgetFloating(note) {
  if (!note.floating) return;
  note.floating = false;
  tellWorker();
}

/**
 * Bring the board in line with what the database says.
 *
 * The change can have come from either end: the worker makes a note from a
 * webpage's right-click and writes straight into IndexedDB, where this board's
 * copy knows nothing about it, and a frame out on a page can stop floating a
 * note this board has on screen — or be typed into.
 */
export async function syncFloating() {
  const records = (await getAll(NOTES)).filter((n) => !n.deleted);
  const floating = new Set(records.filter((n) => n.floating).map((n) => n.id));

  records.forEach((record) => {
    const known = notes.get(record.id);
    if (!known) return; // not on the board in front of us; its page will draw it
    // Typed into on a webpage while this board had it on screen.
    adoptRecord(record);
    const still = notes.get(record.id);
    if (!still) return;
    still.note.floating = floating.has(record.id);
    markFloating(still.note, still.el);
  });
}

// Host access is the user's to give, and it is asked for from the click that
// needed it. Already granted is the common case and prompts nothing.
async function requestPages() {
  const origins = ["<all_urls>"];
  if (await chrome.permissions.contains({ origins }).catch(() => false)) return true;
  return chrome.permissions.request({ origins }).catch(() => false);
}

// The worker owns whether the overlay is registered on webpages at all, and it
// cannot see a write the board made straight into IndexedDB.
//
// `spread` also asks it to put a widget on every page that is already open.
// Starting to float is exactly when that matters: the note is meant to be on
// the page you were reading, not on the next one you load.
function tellWorker({ spread = true } = {}) {
  chrome.runtime.sendMessage({ type: "easynote:float-sync", spread }).catch(() => {});
}

// Drawn after the board's own notes, since all this does is mark ones that are
// already on screen.
registerLayer({
  name: "floating",
  order: 30,
  clear: () => {},
  load: syncFloating,
});
