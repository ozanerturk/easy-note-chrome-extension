// Gallery mode: the board's pictures, one at a time and full size.
//
// A photo in a note is a thumbnail of itself — the note is sized for the text
// around it, and the only way to see the picture properly was to blow the
// whole note up. Double-clicking one opens it here instead, with every other
// picture on the board behind it, so notes that collect pictures can be
// looked through rather than only read.
//
// The reel is the whole board, not the page you happen to be on: every
// picture in every note, newest note first. Pictures are filed by what they
// are about, which is rarely the same as which page they ended up on, so a
// gallery that stopped at the page edge would be the wrong shape for looking
// for one — and once it crosses pages, "where on the board" is no longer an
// order anyone can hold in their head. When a picture was put down is, which
// is why they run by date instead.
//
// Each frame says where its note lives and when it was last written in, and
// "go to note" opens it, switching pages if that is what it takes.

import { NOTES, TRAY_ID, getAll } from "./db.js";
import { notes } from "./store.js";
import { imageUrlFor, imageIdsIn, whenLabel, timestampOf } from "./note.js";
import { pathOf } from "./pages.js";
import { markUsed } from "./tips.js";

const root = document.getElementById("gallery");
const frame = document.getElementById("gallery-img");
const counter = document.getElementById("gallery-count");
const prevBtn = document.getElementById("gallery-prev");
const nextBtn = document.getElementById("gallery-next");
const where = document.getElementById("gallery-where");
const when = document.getElementById("gallery-when");
const gotoBtn = document.getElementById("gallery-goto");
const closeBtn = document.getElementById("gallery-close");

// [{ id, noteId, pageId, where, when }], built when the gallery opens. A
// snapshot rather than a live list: the board cannot change while it is up,
// and an index into something that shifts underneath is worse than a stale
// one.
let reel = [];
let at = 0;
// Bumped on every show, so a slow image arriving after you have paged past it
// does not overwrite the one you are looking at.
let token = 0;
let onGoTo = () => {};

export function galleryIsOpen() {
  return !root.hidden;
}

/**
 * Every picture on the board, newest note first.
 *
 * Off the records rather than the DOM, because most of these notes are on
 * pages that are not rendered. The one exception is a note that is on screen:
 * its live copy carries an edit that the database may be a moment behind on,
 * so an image pasted a second ago is in the reel too.
 */
async function collect() {
  return (await getAll(NOTES))
    // Captures are not on a board yet, so "go to note" would have nowhere to
    // go — the same reason search leaves them out.
    .filter((r) => !r.deleted && r.pageId !== TRAY_ID)
    .map((r) => notes.get(r.id)?.note || r)
    .sort((a, b) => timestampOf(b) - timestampOf(a))
    .flatMap((note) =>
      // Within one note the images keep the order they were written in:
      // whatever a note has to say about its own pictures, it says by the
      // order it puts them in.
      imageIdsIn(note.html).map((id) => ({
        id,
        noteId: note.id,
        pageId: note.pageId,
        where: pathOf(note.pageId),
        when: whenLabel(note),
      }))
    );
}

async function show(index) {
  at = (index + reel.length) % reel.length;
  const mine = ++token;
  const item = reel[at];

  counter.textContent = `${at + 1} / ${reel.length}`;
  // Where this picture lives and when its note was last written in. Two facts
  // that place it, rather than a line of the note's text — which is as likely
  // to be about something else entirely as it is to be about the picture.
  where.textContent = item.where;
  when.textContent = item.when;
  // One picture is not a reel; the arrows would be two buttons that do
  // nothing.
  prevBtn.hidden = nextBtn.hidden = reel.length < 2;

  frame.classList.add("is-loading");
  const url = await imageUrlFor(item.id);
  if (mine !== token) return;
  frame.classList.remove("is-loading");
  // A picture whose blob has been purged: say so rather than showing the one
  // before it under the new number.
  frame.src = url || "";
  frame.alt = url ? "" : "This image is no longer stored";
}

/** Open on one image, with the rest of the page's pictures either side. */
export async function openGallery(imgId) {
  reel = await collect();
  if (!reel.length) return;
  markUsed("gallery");
  const start = reel.findIndex((item) => item.id === imgId);
  root.hidden = false;
  document.body.classList.add("gallery-open");
  window.addEventListener("keydown", onKey, true);
  show(start === -1 ? 0 : start);
}

export function closeGallery() {
  if (root.hidden) return;
  root.hidden = true;
  document.body.classList.remove("gallery-open");
  window.removeEventListener("keydown", onKey, true);
  token++; // anything still loading is no longer wanted
  frame.removeAttribute("src");
  reel = [];
}

/** Out of the reel and back to the words the picture belongs to. */
function goToCurrent() {
  const item = reel[at];
  closeGallery();
  if (item) onGoTo(item.noteId, item.pageId);
}

function onKey(e) {
  // Capture phase, and loud about it: while the gallery is up it owns these
  // keys outright — Escape must not also step out of the note behind it, and
  // the arrows must not reach the board.
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closeGallery();
    return;
  }
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    e.stopPropagation();
    show(at + (e.key === "ArrowLeft" ? -1 : 1));
    return;
  }
  // Arrows to look, Enter to go there. The two keys are the whole gallery
  // without reaching for the mouse.
  if (e.key === "Enter") {
    e.preventDefault();
    e.stopPropagation();
    goToCurrent();
  }
}

/**
 * Wire the gallery up.
 *
 * `goTo(noteId, pageId)` is main.js's one way of putting a named note on
 * screen — the same one search and the due badges use.
 */
export function initGallery(goTo) {
  onGoTo = goTo;

  // Delegated from the document rather than from the canvas: a fullscreen
  // note is re-parented out of #canvas into the overlay, and its pictures
  // should open the same way there.
  document.addEventListener("dblclick", (e) => {
    const img = e.target.closest?.("img[data-img-id]");
    if (!img || !img.closest(".note")) return;
    // Inside the editor a double-click would select the image node, which
    // leaves a highlighted box behind the gallery.
    e.preventDefault();
    e.stopPropagation();
    openGallery(img.dataset.imgId);
  });

  prevBtn.addEventListener("click", () => show(at - 1));
  nextBtn.addEventListener("click", () => show(at + 1));
  closeBtn.addEventListener("click", closeGallery);

  gotoBtn.addEventListener("click", goToCurrent);

  // The backdrop is the way out for anyone who does not reach for Escape.
  // The picture and the bar are not backdrop, so a mis-hit near either does
  // not close what you are looking at.
  root.addEventListener("pointerdown", (e) => {
    if (e.target === root) closeGallery();
  });
}
