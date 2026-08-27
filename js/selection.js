import { notes } from "./store.js";
import { NOTES, put } from "./db.js";
import { canvas } from "./view.js";

export const selected = new Set();

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
  toolbar.classList.toggle("is-visible", selected.size >= 2);
  countLabel.textContent = `${selected.size} selected`;
}

export function clearSelection() {
  if (!selected.size) return;
  selected.clear();
  syncUI();
}

export function selectOnly(id) {
  selected.clear();
  selected.add(id);
  syncUI();
}

export function toggleSelect(id) {
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  syncUI();
}

export function selectAll() {
  notes.forEach((_, id) => selected.add(id));
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
  if (marquee.additive) marquee.base.forEach((id) => selected.add(id));
  notes.forEach(({ el }, id) => {
    const b = el.getBoundingClientRect();
    const hit = b.right >= r.left && b.left <= r.right && b.bottom >= r.top && b.top <= r.bottom;
    if (hit) selected.add(id);
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
  return selectedList().map(({ note, el }) => ({
    note,
    el,
    w: el.offsetWidth,
    h: el.offsetHeight,
  }));
}

// A locked note keeps its place. It still counts towards working out where
// the others go — lining things up against something pinned is half the point
// of pinning it — but nothing in here moves it.
function commit(list) {
  list.forEach(({ note, el }) => {
    if (note.locked) return;
    el.style.left = `${note.x}px`;
    el.style.top = `${note.y}px`;
    put(NOTES, note).catch(() => {});
  });
}

export function align(mode) {
  const list = boxes();
  if (list.length < 2) return;

  if (mode === "left" || mode === "centre" || mode === "right") {
    const min = Math.min(...list.map((b) => b.note.x));
    const max = Math.max(...list.map((b) => b.note.x + b.w));
    const mid = (min + max) / 2;
    list.forEach((b) => {
      if (b.note.locked) return;
      if (mode === "left") b.note.x = min;
      else if (mode === "right") b.note.x = max - b.w;
      else b.note.x = mid - b.w / 2;
    });
  } else {
    const min = Math.min(...list.map((b) => b.note.y));
    const max = Math.max(...list.map((b) => b.note.y + b.h));
    const mid = (min + max) / 2;
    list.forEach((b) => {
      if (b.note.locked) return;
      if (mode === "top") b.note.y = min;
      else if (mode === "bottom") b.note.y = max - b.h;
      else b.note.y = mid - b.h / 2;
    });
  }
  commit(list);
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
    if (!b.note.locked) b.note[pos] = cursor;
    cursor += b[size] + gap;
  });
  commit(list);
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
    if (b.note.locked) return; // its cell stays empty rather than moving it
    b.note.x = originX + (i % cols) * colW;
    b.note.y = originY + Math.floor(i / cols) * rowH;
  });
  commit(list);
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
