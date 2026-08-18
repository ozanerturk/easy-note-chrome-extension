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
} from "./view.js";
import {
  createNote,
  loadNote,
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
} from "./selection.js";

const isEditing = () =>
  document.activeElement && document.activeElement.isContentEditable;

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
    // Locked notes survive; deleteNote() refuses them.
    selectedList().forEach(({ note, el }) => deleteNote(note, el));
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

initPanZoom();
initSelection();

openDB()
  .then(() => Promise.all([getAll(NOTES), getOne(META, "view"), getOne(META, "prefs")]))
  .then(([records, savedView, prefs]) => {
    if (savedView) setView(savedView);
    else applyView();

    records.forEach(loadNote);
    setShowDates(!!(prefs && prefs.showDates), false);
    updateHint();
  })
  .catch((err) => console.error("Easy Note failed to start:", err));
