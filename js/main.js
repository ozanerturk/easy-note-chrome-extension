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
  fitToNotes,
  persistViewNow,
  viewKey,
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
import { initSyncUI, setSyncAppliedHandler } from "./syncui.js";
import { migrateFromV1 } from "./migrate/v1.js";
import { initWhatsNew } from "./whatsnew.js";
import { notes } from "./store.js";
import { purgeTombstones } from "./note.js";
import { adoptPages, renderTree as renderPageTree } from "./pages.js";
import { PAGES } from "./db.js";

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
initSyncUI();

// A sync that pulled anything has changed pages and notes underneath us.
setSyncAppliedHandler(async () => {
  adoptPages(await getAll(PAGES));
  renderPageTree();
  await showCurrentPage();
});

setPageSwitchHandler(async (id, previous) => {
  await persistViewNow(previous); // also cancels the pending debounced save
  clearSelection();
  await showCurrentPage();
  await restoreViewFor(id);
});

// Each page remembers where you were. A page seen for the first time gets
// framed instead, so its notes are never off-screen on arrival.
async function restoreViewFor(pageId) {
  const saved = await getOne(META, viewKey(pageId));
  if (saved) setView(saved);
  else fitToNotes();
}

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

    // Bring the published v1's notes across before the first render, so an
    // upgrading user never sees an empty canvas.
    const migration = await migrateFromV1(currentPageId);
    if (migration.imported) {
      console.info(`Easy Note: imported ${migration.imported} notes from v1`);
    }
    if (migration.error) {
      console.error("Easy Note: v1 import failed —", migration.error);
    }

    renderTree();

    const [pageView, legacyView, prefs, sidebarPref] = await Promise.all([
      getOne(META, viewKey(currentPageId)),
      getOne(META, "view"), // pre per-page viewports
      getOne(META, "prefs"),
      getOne(META, "sidebar"),
    ]);

    const hidden = !!(sidebarPref && sidebarPref.hidden);
    document.documentElement.classList.toggle("sidebar-hidden", hidden);
    try {
      localStorage.setItem("easynote:sidebar", hidden ? "hidden" : "shown");
    } catch (e) {
      /* ignore */
    }

    const startView = pageView || legacyView;
    if (startView) setView(startView);
    else applyView();

    await showCurrentPage();
    if (!startView) fitToNotes();
    setShowDates(!!(prefs && prefs.showDates), false);
    purgeTombstones().catch(() => {});

    // Someone with notes already — imported from v1 or created here — is an
    // upgrader, so the release notes are worth pointing at.
    const returning = notes.size > 0 || migration.imported > 0;
    initWhatsNew(returning).catch(() => {});
  })
  .catch((err) => console.error("Easy Note failed to start:", err));
