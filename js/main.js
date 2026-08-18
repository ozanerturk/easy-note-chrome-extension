import { openDB, getAll, getOne, NOTES, META } from "./db.js";
import {
  canvas,
  applyView,
  setView,
  initPanZoom,
  screenToWorld,
  didJustPan,
  isPanGesture,
  beginPan,
  focusNote,
} from "./view.js";
import {
  createNote,
  loadNote,
  clearBoard,
  updateHint,
  setShowDates,
  isFullscreen,
  deleteNote,
} from "./note.js";
import {
  initSelection,
  beginMarquee,
  isMarqueeActive,
  clearSelection,
  selectAll,
  selectedList,
  selectOnly,
} from "./selection.js";
import {
  initPages,
  ensureDefaultPage,
  adoptOrphans,
  notesOnCurrentPage,
  renderTree,
  setPageSwitchHandler,
  switchPage,
  currentPageId,
} from "./pages.js";
import { initSearch, setSearchPickHandler } from "./search.js";
import { notes } from "./store.js";

const isEditing = () =>
  document.activeElement &&
  (document.activeElement.isContentEditable || document.activeElement.tagName === "INPUT");

async function showCurrentPage() {
  clearBoard();
  const records = adoptOrphans(await getAll(NOTES));
  notesOnCurrentPage(records).forEach(loadNote);
  updateHint();
}

/* --------------------------------------------------------------- canvas */

canvas.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".note")) return;
  // Middle mouse or space+drag pans; a plain left drag draws a marquee.
  if (e.button === 1 || isPanGesture(e)) {
    e.preventDefault();
    beginPan(e);
  } else if (e.button === 0) {
    beginMarquee(e);
  }
});

canvas.addEventListener("dblclick", (e) => {
  if (e.target.closest(".note") || isFullscreen()) return;
  if (didJustPan() || isMarqueeActive()) return;
  const { x, y } = screenToWorld(e.clientX, e.clientY);
  createNote(x, y);
});

window.addEventListener("keydown", (e) => {
  if (isEditing()) return;

  if ((e.key === "Delete" || e.key === "Backspace") && selectedList().length) {
    e.preventDefault();
    selectedList().forEach(({ note, el }) => deleteNote(note, el)); // locked notes survive
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
    e.preventDefault();
    selectAll();
    return;
  }
  if (e.key === "Escape") clearSelection();
});

document.getElementById("toggle-dates").addEventListener("click", () => {
  setShowDates(!document.body.classList.contains("show-dates"));
});

/* ----------------------------------------------------------------- boot */

initPanZoom();
initSelection();
initPages();
initSearch();

setPageSwitchHandler(async () => {
  clearSelection();
  await showCurrentPage();
});

setSearchPickHandler(async (noteId, pageId) => {
  // A hit on another page needs that page rendered before we can frame it.
  if (pageId !== currentPageId) await switchPage(pageId);
  const entry = notes.get(noteId);
  if (!entry) return;
  selectOnly(noteId);
  focusNote(entry.el);
});

openDB()
  .then(async () => {
    await ensureDefaultPage();
    renderTree();

    const [savedView, prefs, sidebarPref] = await Promise.all([
      getOne(META, "view"),
      getOne(META, "prefs"),
      getOne(META, "sidebar"),
    ]);

    if (sidebarPref && sidebarPref.hidden) document.body.classList.add("sidebar-hidden");
    if (savedView) setView(savedView);
    else applyView();

    await showCurrentPage();
    setShowDates(!!(prefs && prefs.showDates), false);
  })
  .catch((err) => console.error("Easy Note failed to start:", err));
