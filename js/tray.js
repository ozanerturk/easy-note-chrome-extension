// The Capture tray — a filmstrip along the bottom of the board.
//
// Architecturally it is not a new thing: it is one reserved page, whose notes
// live in the same store with the same shape and sync the same way. Only the
// rendering differs. That is what buys drag-to-place, delete-with-undo and
// sync here for the price of a renderer.
//
// Nothing in it ever expires. Items fade with age so the eye goes to what is
// recent, but the tray only ever loses something because somebody said so.

import { NOTES, TRAY_ID, getAll, put } from "./db.js";
import { imageIdsIn, imageUrlFor, loadNote, updateHint } from "./note.js";
import { currentPageId, dropTargetAt, moveNotesToPage, setDraggedNotes } from "./pages.js";
import { offerUndo } from "./undo.js";
import { screenToWorld } from "./view.js";
import { getPref, setPref } from "./prefs.js";

const OPEN_HEIGHT = 124;
const COLLAPSED_HEIGHT = 30;
const THUMB_WIDTH = 132;
const DRAG_THRESHOLD = 4;

// Aging is presentation only. A capture from this morning and one from last
// month are equally safe; the older one just stops competing for attention.
const DAY = 24 * 3600 * 1000;
const FADE_STEPS = [
  { after: 14 * DAY, opacity: 0.5 },
  { after: 3 * DAY, opacity: 0.68 },
  { after: 1 * DAY, opacity: 0.84 },
];

const strip = document.getElementById("tray");
const list = document.getElementById("tray-items");
const countEl = document.getElementById("tray-count");
const collapseBtn = document.getElementById("tray-collapse");
const clearBtn = document.getElementById("tray-clear");
const dragLayer = document.getElementById("drag-layer");

let items = []; // the tray's note records, newest first
let collapsed = false;

/* ------------------------------------------------------------------ layout */

// The strip is not an overlay: it takes its height out of the canvas, and the
// floating controls and the undo bar ride up on top of it. An empty tray takes
// nothing at all, so a board that has never been clipped to is unchanged.
function applyHeight() {
  const height = !items.length ? 0 : collapsed ? COLLAPSED_HEIGHT : OPEN_HEIGHT;
  document.documentElement.style.setProperty("--tray-h", `${height}px`);
  strip.classList.toggle("is-open", !!items.length);
  strip.classList.toggle("is-collapsed", collapsed);
}

function ageOpacity(note) {
  const age = Date.now() - (note.createdAt || note.updatedAt || Date.now());
  const step = FADE_STEPS.find((s) => age >= s.after);
  return step ? step.opacity : 1;
}

/* --------------------------------------------------------------- rendering */

function sourceOf(note) {
  const holder = document.createElement("div");
  holder.innerHTML = note.html || "";
  const link = holder.querySelector("a[href]");
  const text = holder.textContent.replace(/\s+/g, " ").trim();
  return { label: text || "Capture", href: link ? link.getAttribute("href") : "" };
}

function thumbFor(note) {
  const item = document.createElement("div");
  item.className = "tray-item";
  item.dataset.noteId = note.id;
  item.style.opacity = ageOpacity(note);

  const shot = document.createElement("img");
  shot.className = "tray-shot";
  shot.alt = "";
  shot.draggable = false;
  const [imgId] = imageIdsIn(note.html);
  if (imgId) imageUrlFor(imgId).then((url) => { if (url) shot.src = url; });

  const { label, href } = sourceOf(note);
  const caption = document.createElement("span");
  caption.className = "tray-caption";
  caption.textContent = label;
  item.title = href ? `${label}\n${href}` : label;

  const remove = document.createElement("button");
  remove.className = "tray-remove";
  remove.textContent = "×";
  remove.title = "Remove from tray";
  remove.addEventListener("pointerdown", (e) => e.stopPropagation()); // not a drag
  remove.addEventListener("click", (e) => {
    e.stopPropagation();
    discard([note]);
  });

  item.append(shot, caption, remove);
  item.addEventListener("pointerdown", (e) => beginDrag(e, note, item));
  return item;
}

function paint() {
  list.textContent = "";
  items.forEach((note) => list.appendChild(thumbFor(note)));
  countEl.textContent = String(items.length);
  applyHeight();
}

/** Re-read the tray from the database and redraw the strip. */
export async function refreshTray() {
  const records = await getAll(NOTES);
  items = records
    .filter((n) => !n.deleted && n.pageId === TRAY_ID)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  paint();
}

/* ---------------------------------------------------------------- removing */

// The same bargain a deleted note gets: a tombstone rather than a deletion, so
// the removal can propagate, and a few seconds to take it back. "Clear all"
// needs no confirm dialog for the same reason a bulk delete on the board does
// not — the undo bar is the confirmation, offered after the fact instead of
// standing in front of the action every time.
function discard(records) {
  if (!records.length) return;
  const at = Date.now();
  records.forEach((note) => {
    note.deleted = true;
    note.deletedAt = at;
    note.updatedAt = at;
    put(NOTES, note).catch(() => {});
  });
  refreshTray();

  const what = records.length === 1 ? "Capture removed" : `${records.length} captures removed`;
  offerUndo(what, async () => {
    for (const note of records) {
      delete note.deleted;
      delete note.deletedAt;
      note.updatedAt = Date.now();
      await put(NOTES, note).catch(() => {});
    }
    refreshTray();
  });
}

/* --------------------------------------------------------------- placement */

// Dragging a thumbnail out is the only way to place a capture — the same
// gesture that moves a note between pages everywhere else, so there is no
// "Add to page" button to explain.
function beginDrag(e, note, item) {
  if (e.button !== 0) return;
  e.preventDefault();

  const start = { x: e.clientX, y: e.clientY };
  let ghost = null;

  const stop = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("keydown", onKey, true);
  };

  // Escape abandons the drag, as it does on the board. The capture simply
  // stays in the tray — nothing was moved yet.
  const onKey = (keyEvent) => {
    if (keyEvent.key !== "Escape") return;
    keyEvent.preventDefault();
    keyEvent.stopPropagation();
    stop();
    if (ghost) ghost.remove();
    item.classList.remove("is-dragging");
    setDraggedNotes(null);
  };

  const onMove = (m) => {
    if (!ghost) {
      if (Math.hypot(m.clientX - start.x, m.clientY - start.y) < DRAG_THRESHOLD) return;
      ghost = item.cloneNode(true);
      ghost.classList.add("is-ghost");
      dragLayer.appendChild(ghost);
      item.classList.add("is-dragging");
      // Lights up the sidebar rows. `from` is the tray, not the board, so the
      // page currently on screen is a legal target like any other.
      setDraggedNotes([note.id]);
    }
    ghost.style.left = `${m.clientX - THUMB_WIDTH / 2}px`;
    ghost.style.top = `${m.clientY - 34}px`;
  };

  const onUp = async (up) => {
    stop();
    item.classList.remove("is-dragging");
    if (!ghost) return; // a click, not a drag: a capture is placed, not opened
    ghost.remove();

    const onPage = dropTargetAt(up.clientX, up.clientY);
    setDraggedNotes(null);

    if (onPage) {
      await place(note, onPage);
      return;
    }
    // Dropped on the board itself: it lands where it was let go of.
    const canvas = document.getElementById("canvas");
    const rect = canvas.getBoundingClientRect();
    const inside =
      up.clientX >= rect.left && up.clientX <= rect.right && up.clientY >= rect.top && up.clientY <= rect.bottom;
    if (!inside) return; // dropped nowhere; it stays in the tray

    const at = screenToWorld(up.clientX, up.clientY);
    note.x = Math.round(at.x - (note.width || 200) / 2);
    note.y = Math.round(at.y - (note.height || 150) / 2);
    await place(note, currentPageId);
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("keydown", onKey, true);
}

async function place(note, pageId) {
  await moveNotesToPage([note], pageId);
  if (pageId === currentPageId) {
    loadNote(note);
    updateHint();
  }
  await refreshTray();
}

/* -------------------------------------------------------------------- boot */

export function initTray() {
  collapsed = !!getPref("trayCollapsed");
  applyHeight();

  collapseBtn.addEventListener("click", () => {
    collapsed = !collapsed;
    setPref("trayCollapsed", collapsed);
    applyHeight();
  });

  clearBtn.addEventListener("click", () => discard([...items]));
}
