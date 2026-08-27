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
  activateNote,
  setBlurNotes,
  isBlurred,
  clearActiveNote,
  createNoteWithContent,
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
  applySidebarWidth,
  currentPageId,
} from "./pages.js";
import { initSearch, setSearchPickHandler } from "./search.js";
import { initSyncUI, setSyncAppliedHandler } from "./syncui.js";
import { migrateFromV1 } from "./migrate/v1.js";
import { initWhatsNew } from "./whatsnew.js";
import { notes } from "./store.js";
import { loadPrefs, getPref } from "./prefs.js";
import { runUndo, hasPendingUndo, hideUndo } from "./undo.js";
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
  // Middle mouse or space+drag pans. A pan has to work wherever the cursor is,
  // notes included, or the board locks up under a crowded canvas.
  if (e.button === 1 || isPanGesture(e)) {
    e.preventDefault();
    beginPan(e);
    return;
  }
  if (e.target.closest(".note")) return;
  clearActiveNote(); // the empty canvas is nobody's note
  if (e.button === 0) beginMarquee(e); // a plain left drag draws a marquee
});

// Chrome answers a mousedown on the bare canvas by hunting for the nearest
// selectable text — which is the note you just left. It restores a selection
// there and hands focus back with it, so the note springs straight back to
// life. There is nothing out here to select; the marquee does that job.
canvas.addEventListener("selectstart", (e) => {
  // The target can be a text node, which has no closest().
  const node = e.target;
  const from = node && node.nodeType === Node.ELEMENT_NODE ? node : node && node.parentElement;
  if (!from || !from.closest(".note")) e.preventDefault();
});

canvas.addEventListener("dblclick", (e) => {
  if (e.target.closest(".note") || isFullscreen()) return;
  if (didJustPan() || isMarqueeActive()) return;
  const { x, y } = screenToWorld(e.clientX, e.clientY);
  createNote(x, y);
});

/* ------------------------------------------------------------- clipboard */

// Where a pasted note lands. The pointer if it has been over the canvas,
// otherwise the middle of the view.
let lastPointer = null;
canvas.addEventListener("pointermove", (e) => {
  lastPointer = { x: e.clientX, y: e.clientY };
});

function pasteOrigin() {
  const rect = canvas.getBoundingClientRect();
  const at = lastPointer || { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  return screenToWorld(at.x, at.y);
}

// A paste with no note focused makes a note of what was pasted, where the
// cursor is. This path costs no permission at all: the event carries the
// clipboard with it.
document.addEventListener("paste", (e) => {
  if (isEditing() || isFullscreen()) return;
  const data = e.clipboardData;
  if (!data) return;

  const blobs = [...data.items]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  const html = data.getData("text/html");
  const text = data.getData("text/plain");
  if (!blobs.length && !html && !text) return;

  e.preventDefault();
  const { x, y } = pasteOrigin();
  createNoteWithContent(x, y, { html, text, blobs });
});

// Ctrl+P does the same without the paste gesture, by asking for the clipboard
// directly. Chrome puts its own one-time prompt in front of that; if it is
// refused, an empty note still opens at the cursor to paste into by hand.
async function readClipboard() {
  if (!navigator.clipboard || !navigator.clipboard.read) return null;
  try {
    const items = await navigator.clipboard.read();
    const out = { html: "", text: "", blobs: [] };
    for (const item of items) {
      const image = item.types.find((t) => t.startsWith("image/"));
      if (image) out.blobs.push(await item.getType(image));
      if (item.types.includes("text/html")) out.html = await (await item.getType("text/html")).text();
      if (item.types.includes("text/plain")) out.text = await (await item.getType("text/plain")).text();
    }
    return out;
  } catch (err) {
    return null; // no permission, or nothing readable on the clipboard
  }
}

window.addEventListener("keydown", async (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "p") return;
  e.preventDefault(); // and no print dialog
  const { x, y } = pasteOrigin();
  const content = await readClipboard();
  if (content && (content.html || content.text || content.blobs.length)) {
    createNoteWithContent(x, y, content);
  } else {
    createNote(x, y);
  }
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
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && hasPendingUndo()) {
    e.preventDefault();
    runUndo();
    return;
  }

  if (e.altKey && (e.key === "b" || e.key === "B" || e.code === "KeyB")) {
    e.preventDefault();
    setBlurNotes(!isBlurred());
    return;
  }

  if (e.key === "Escape") clearSelection(); // note.js owns deactivating
});

document.getElementById("toggle-dates").addEventListener("click", () => {
  setShowDates(!document.body.classList.contains("show-dates"));
});

document.getElementById("toggle-blur").addEventListener("click", () => {
  setBlurNotes(!isBlurred());
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
  clearActiveNote(); // leaving the page counts as leaving the note
  hideUndo(); // the offer refers to notes on the page being left
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
  focusNote(entry.el); // pans only — the zoom the user set is left alone
  activateNote(entry);
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

    const [pageView, legacyView, , sidebarPref, sidebarWidth] = await Promise.all([
      getOne(META, viewKey(currentPageId)),
      getOne(META, "view"), // pre per-page viewports
      loadPrefs(),
      getOne(META, "sidebar"),
      getOne(META, "sidebarWidth"),
    ]);

    // boot.js already applied the width from localStorage, which is written
    // synchronously. The IndexedDB copy can lag a reload that lands mid-write,
    // so it is only a fallback — for a profile that has never set one here.
    let hasLocalWidth = false;
    try {
      hasLocalWidth = !!localStorage.getItem("easynote:sidebarWidth");
    } catch (e) {
      /* ignore */
    }
    if (!hasLocalWidth && sidebarWidth && sidebarWidth.width) {
      applySidebarWidth(sidebarWidth.width);
    }

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
    setShowDates(!!getPref("showDates"), false);
    // boot.js already applied the class from localStorage; this only syncs the
    // button, and covers a profile whose pref arrived by sync.
    setBlurNotes(isBlurred() || !!getPref("blurNotes"), false);
    purgeTombstones().catch(() => {});

    // Someone with notes already — imported from v1 or created here — is an
    // upgrader, so the release notes are worth pointing at. Count what is in
    // the database, not what this page happens to be showing: a second tab
    // sitting on an empty page would otherwise look like a new install and
    // silently mark the release as seen for everyone.
    const stored = await getAll(NOTES);
    const returning = stored.some((n) => !n.deleted) || migration.imported > 0;
    initWhatsNew(returning).catch(() => {});
  })
  .catch((err) => console.error("Easy Note failed to start:", err));
