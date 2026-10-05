import { notes } from "./store.js";
import { NOTES, put } from "./db.js";
import { canvas, world } from "./view.js";
import { recordMove } from "./note.js";

export const selected = new Set();

// Lists are picked out too — by the marquee, or Shift-clicking a list's name —
// so a list moves with the notes around it. Its cards are never picked out on
// their own by a marquee: they are inside the list, and they go where it goes.
// Picking them was what used to tear them out of it on the next drag.
export const selectedLists = new Set();

export function isListSelected(id) {
  return selectedLists.has(id);
}

/** Everything picked out, notes and lists together. */
export function selectionSize() {
  return selected.size + selectedLists.size;
}

const listEls = () => [...world.querySelectorAll(":scope > .list")];

const marqueeBox = document.getElementById("marquee");
const toolbar = document.getElementById("arrange");
const countLabel = document.getElementById("arrange-count");

export function isSelected(id) {
  return selected.has(id);
}

export function selectedList() {
  return [...selected].map((id) => notes.get(id)).filter(Boolean);
}

function syncUI() {
  notes.forEach(({ el }, id) => el.classList.toggle("is-selected", selected.has(id)));
  listEls().forEach((el) => el.classList.toggle("is-selected", selectedLists.has(el.dataset.listId)));
  // The arrange tools line up notes; a list does not take part in them.
  toolbar.classList.toggle("is-visible", selected.size >= 2);
  countLabel.textContent = `${selected.size} selected`;
}

export function clearSelection() {
  if (!selectionSize()) return;
  selected.clear();
  selectedLists.clear();
  syncUI();
}

export function selectOnly(id) {
  selected.clear();
  selectedLists.clear();
  selected.add(id);
  syncUI();
}

export function selectOnlyList(id) {
  selected.clear();
  selectedLists.clear();
  selectedLists.add(id);
  syncUI();
}

export function toggleListSelect(id) {
  if (selectedLists.has(id)) selectedLists.delete(id);
  else selectedLists.add(id);
  syncUI();
}

export function forgetListSelection(id) {
  if (selectedLists.delete(id)) syncUI();
}

// A paste, or anything else that hands you back a batch: the notes it made are
// the ones now selected, so the next thing you do lands on them.
export function selectNotes(ids) {
  selected.clear();
  selectedLists.clear();
  ids.forEach((id) => selected.add(id));
  syncUI();
}

export function toggleSelect(id) {
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  syncUI();
}

export function selectAll() {
  // The loose notes and the lists; a list's cards come with it.
  notes.forEach(({ el }, id) => {
    if (!el.classList.contains("is-listed")) selected.add(id);
  });
  listEls().forEach((el) => selectedLists.add(el.dataset.listId));
  syncUI();
}

export function forgetSelection(id) {
  if (selected.delete(id)) syncUI();
}

/* ---------------------------------------------------------------- marquee */

let marquee = null;

export function beginMarquee(e) {
  marquee = {
    id: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    additive: e.shiftKey || e.metaKey || e.ctrlKey,
    base: new Set(selected),
    baseLists: new Set(selectedLists),
    moved: false,
  };
}

export function isMarqueeActive() {
  return !!marquee && marquee.moved;
}

function marqueeRect(e) {
  return {
    left: Math.min(marquee.startX, e.clientX),
    top: Math.min(marquee.startY, e.clientY),
    right: Math.max(marquee.startX, e.clientX),
    bottom: Math.max(marquee.startY, e.clientY),
  };
}

function moveMarquee(e) {
  if (!marquee || e.pointerId !== marquee.id) return;
  const dx = e.clientX - marquee.startX;
  const dy = e.clientY - marquee.startY;
  if (!marquee.moved && Math.hypot(dx, dy) < 4) return;
  marquee.moved = true;

  const r = marqueeRect(e);
  marqueeBox.style.display = "block";
  marqueeBox.style.left = `${r.left}px`;
  marqueeBox.style.top = `${r.top}px`;
  marqueeBox.style.width = `${r.right - r.left}px`;
  marqueeBox.style.height = `${r.bottom - r.top}px`;

  // getBoundingClientRect already accounts for the world transform, so the
  // hit test stays correct at any zoom.
  selected.clear();
  selectedLists.clear();
  if (marquee.additive) {
    marquee.base.forEach((id) => selected.add(id));
    marquee.baseLists.forEach((id) => selectedLists.add(id));
  }
  const hit = (el) => {
    const b = el.getBoundingClientRect();
    return b.right >= r.left && b.left <= r.right && b.bottom >= r.top && b.top <= r.bottom;
  };
  notes.forEach(({ el }, id) => {
    if (!el.classList.contains("is-listed") && hit(el)) selected.add(id);
  });
  listEls().forEach((el) => {
    if (hit(el)) selectedLists.add(el.dataset.listId);
  });
  syncUI();
}

function endMarquee(e) {
  if (!marquee || e.pointerId !== marquee.id) return;
  const wasDrag = marquee.moved;
  const additive = marquee.additive;
  marquee = null;
  marqueeBox.style.display = "none";
  // A plain click on empty canvas clears the selection.
  if (!wasDrag && !additive) clearSelection();
}

/* --------------------------------------------------------------- arranging */

function boxes() {
  // A note in a list is not on the canvas in any sense an arrange can use: it
  // has no position of its own, and writing one would scatter the board behind
  // the list without anything visibly happening. A marquee no longer picks
  // cards, but Shift-clicking one still can, and it sits out the arranging.
  return selectedList()
    .filter(({ note }) => !note.listId)
    .map(({ note, el }) => ({
      note,
      el,
      w: el.offsetWidth,
      h: el.offsetHeight,
      // Where it stood before any of this. Tidying a board is exactly the kind
      // of thing you want to be able to take back in one go, so every arrange
      // carries what it would take to put things back.
      from: { x: note.x, y: note.y },
    }));
}

function commit(list, label) {
  list.forEach(({ note, el }) => {
    el.style.left = `${note.x}px`;
    el.style.top = `${note.y}px`;
    put(NOTES, note).catch(() => {});
  });
  recordMove(list, label);
}

export function align(mode) {
  const list = boxes();
  if (list.length < 2) return;

  if (mode === "left" || mode === "centre" || mode === "right") {
    const min = Math.min(...list.map((b) => b.note.x));
    const max = Math.max(...list.map((b) => b.note.x + b.w));
    const mid = (min + max) / 2;
    list.forEach((b) => {
      if (mode === "left") b.note.x = min;
      else if (mode === "right") b.note.x = max - b.w;
      else b.note.x = mid - b.w / 2;
    });
  } else {
    const min = Math.min(...list.map((b) => b.note.y));
    const max = Math.max(...list.map((b) => b.note.y + b.h));
    const mid = (min + max) / 2;
    list.forEach((b) => {
      if (mode === "top") b.note.y = min;
      else if (mode === "bottom") b.note.y = max - b.h;
      else b.note.y = mid - b.h / 2;
    });
  }
  commit(list, "the alignment");
}

const MIN_GAP = 16;

// Equal gaps between edges, keeping the existing bounding box where it fits.
export function distribute(axis) {
  const list = boxes();
  if (list.length < 3) return;
  const pos = axis === "h" ? "x" : "y";
  const size = axis === "h" ? "w" : "h";

  list.sort((a, b) => a.note[pos] - b.note[pos]);
  const first = list[0];
  const last = list[list.length - 1];
  const start = first.note[pos];
  const end = last.note[pos] + last[size];
  const occupied = list.reduce((sum, b) => sum + b[size], 0);
  // When the notes are taller/wider than their bounds the even gap comes out
  // negative, which would stack them on top of each other. Grow instead.
  const gap = Math.max(MIN_GAP, (end - start - occupied) / (list.length - 1));

  let cursor = start;
  list.forEach((b) => {
    b.note[pos] = cursor;
    cursor += b[size] + gap;
  });
  commit(list, "the spacing");
}

export function arrangeGrid() {
  const list = boxes();
  if (list.length < 2) return;
  const GAP = 24;

  // Reading order, so the grid roughly preserves how they were laid out.
  list.sort((a, b) => a.note.y - b.note.y || a.note.x - b.note.x);

  const cols = Math.ceil(Math.sqrt(list.length));
  const colW = Math.max(...list.map((b) => b.w)) + GAP;
  const rowH = Math.max(...list.map((b) => b.h)) + GAP;
  const originX = Math.min(...list.map((b) => b.note.x));
  const originY = Math.min(...list.map((b) => b.note.y));

  list.forEach((b, i) => {
    b.note.x = originX + (i % cols) * colW;
    b.note.y = originY + Math.floor(i / cols) * rowH;
  });
  commit(list, "the grid");
}

/* ------------------------------------------------------------------- init */

export function initSelection() {
  // On window, so a marquee dragged past the canvas edge still resolves.
  window.addEventListener("pointermove", moveMarquee);
  window.addEventListener("pointerup", endMarquee);
  window.addEventListener("pointercancel", endMarquee);

  toolbar.querySelectorAll("[data-align]").forEach((btn) =>
    btn.addEventListener("click", () => align(btn.dataset.align))
  );
  toolbar.querySelectorAll("[data-distribute]").forEach((btn) =>
    btn.addEventListener("click", () => distribute(btn.dataset.distribute))
  );
  toolbar.querySelector("[data-grid]").addEventListener("click", arrangeGrid);
}

export { syncUI as refreshSelectionUI };
