import { put, META } from "./db.js";
import { currentPageId } from "./pages.js";

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 4;
export const GRID = 24;
const PAN_THRESHOLD = 3;
const PAN_CLICK_GRACE = 300;

export const canvas = document.getElementById("canvas");
export const world = document.getElementById("world");
const zoomLevelBtn = document.getElementById("zoom-level");

// Notes live in world coordinates; the view maps world -> screen.
export const view = { x: 0, y: 0, zoom: 1 };

export function screenToWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left - view.x) / view.zoom,
    y: (clientY - rect.top - view.y) / view.zoom,
  };
}

export const viewKey = (pageId) => `view:${pageId}`;

let viewSaveTimer;
function saveView() {
  clearTimeout(viewSaveTimer);
  const pageId = currentPageId;
  if (!pageId) return;
  viewSaveTimer = setTimeout(() => {
    put(META, { id: viewKey(pageId), ...view }).catch(() => {});
  }, 250);
}

// Write the current view against a specific page immediately, cancelling any
// pending debounce. Used when leaving a page, since by the time the switch
// handler runs currentPageId already points at the new page.
export function persistViewNow(pageId) {
  clearTimeout(viewSaveTimer);
  if (!pageId) return Promise.resolve();
  return put(META, { id: viewKey(pageId), ...view }).catch(() => {});
}

export function applyView() {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  const gap = GRID * view.zoom;
  canvas.style.backgroundSize = `${gap}px ${gap}px`;
  canvas.style.backgroundPosition = `${view.x}px ${view.y}px`;
  zoomLevelBtn.textContent = `${Math.round(view.zoom * 100)}%`;
  saveView();
}

export function setView(next) {
  view.x = next.x ?? view.x;
  view.y = next.y ?? view.y;
  view.zoom = next.zoom ?? view.zoom;
  applyView();
}

// Keep the world point under the cursor pinned while the scale changes.
export function zoomAt(clientX, clientY, factor) {
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
  if (next === view.zoom) return;
  const rect = canvas.getBoundingClientRect();
  const before = screenToWorld(clientX, clientY);
  view.zoom = next;
  view.x = clientX - rect.left - before.x * view.zoom;
  view.y = clientY - rect.top - before.y * view.zoom;
  applyView();
}

function zoomFromCentre(factor) {
  const r = canvas.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
}

function boundsOf(els) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  els.forEach((el) => {
    const x = parseFloat(el.style.left);
    const y = parseFloat(el.style.top);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + el.offsetWidth);
    maxY = Math.max(maxY, y + el.offsetHeight);
  });
  return { minX, minY, maxX, maxY };
}

function frame(bounds, pad, maxZoom) {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, bounds.maxX - bounds.minX);
  const h = Math.max(1, bounds.maxY - bounds.minY);
  const zoom = Math.min(
    maxZoom,
    Math.max(MIN_ZOOM, Math.min((rect.width - pad * 2) / w, (rect.height - pad * 2) / h))
  );
  view.zoom = zoom;
  view.x = (rect.width - w * zoom) / 2 - bounds.minX * zoom;
  view.y = (rect.height - h * zoom) / 2 - bounds.minY * zoom;
  applyView();
}

export function fitToNotes() {
  const els = [...world.querySelectorAll(".note")];
  if (!els.length) {
    setView({ x: 0, y: 0, zoom: 1 });
    return;
  }
  frame(boundsOf(els), 60, MAX_ZOOM);
}

// Used by search: bring one note into view without zooming absurdly close.
// Used by search: bring one note into view by panning only. Reframing it to
// fit would rescale the whole board, which reads as the layout jumping rather
// than as navigation.
export function focusNote(el) {
  const rect = canvas.getBoundingClientRect();
  const x = parseFloat(el.style.left) || 0;
  const y = parseFloat(el.style.top) || 0;
  const cx = x + el.offsetWidth / 2;
  const cy = y + el.offsetHeight / 2;

  view.x = rect.width / 2 - cx * view.zoom;
  view.y = rect.height / 2 - cy * view.zoom;
  applyView();
}

/* ------------------------------------------------------------ interaction */

let panning = null;
let lastPanEndAt = 0;
let spaceHeld = false;

export function didJustPan() {
  return Date.now() - lastPanEndAt < PAN_CLICK_GRACE;
}

export function isPanGesture(e) {
  return e.button === 1 || spaceHeld;
}

export function beginPan(e) {
  panning = {
    id: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    originX: view.x,
    originY: view.y,
    moved: false,
  };
  canvas.classList.add("is-panning");
}

function movePan(e) {
  if (!panning || e.pointerId !== panning.id) return;
  const dx = e.clientX - panning.startX;
  const dy = e.clientY - panning.startY;
  if (!panning.moved && Math.hypot(dx, dy) > PAN_THRESHOLD) panning.moved = true;
  if (!panning.moved) return;
  view.x = panning.originX + dx;
  view.y = panning.originY + dy;
  applyView();
}

function endPan(e) {
  if (!panning || e.pointerId !== panning.id) return;
  // Remember when a *dragging* pan ended. A plain click that follows must not
  // clear this, or the second click of a drag-then-click pair would read as a
  // deliberate double-click and drop an unwanted note.
  if (panning.moved) lastPanEndAt = Date.now();
  panning = null;
  canvas.classList.remove("is-panning");
}

export function initPanZoom() {
  // On window, so a gesture that leaves the canvas still completes.
  window.addEventListener("pointermove", movePan);
  window.addEventListener("pointerup", endPan);
  window.addEventListener("pointercancel", endPan);

  canvas.addEventListener(
    "wheel",
    (e) => {
      // Zooming is about the board, never about what the cursor happens to be
      // resting on, so it always wins.
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.006));
        return;
      }

      // A note only takes the wheel for its own scrolling while you are
      // working in it. Over any other note the wheel pans the board — the
      // cursor is simply somewhere on the way to where you are going.
      const body = e.target.closest(".note-body");
      const inside = body && body.closest(".note")?.classList.contains("is-active");
      if (inside && body.scrollHeight > body.clientHeight) return;

      e.preventDefault();
      view.x -= e.deltaX;
      view.y -= e.deltaY;
      applyView();
    },
    { passive: false }
  );

  window.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || e.repeat) return;
    if (e.target.isContentEditable || e.target.tagName === "INPUT") return;
    spaceHeld = true;
    canvas.classList.add("space-held");
    e.preventDefault();
  });
  window.addEventListener("keyup", (e) => {
    if (e.code !== "Space") return;
    spaceHeld = false;
    canvas.classList.remove("space-held");
  });
  window.addEventListener("blur", () => {
    spaceHeld = false;
    canvas.classList.remove("space-held");
  });

  document.getElementById("zoom-in").addEventListener("click", () => zoomFromCentre(1.25));
  document.getElementById("zoom-out").addEventListener("click", () => zoomFromCentre(1 / 1.25));
  zoomLevelBtn.addEventListener("click", () => zoomFromCentre(1 / view.zoom));
  document.getElementById("fit").addEventListener("click", fitToNotes);
}
