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
import { createNote, loadNote, updateHint, setShowDates, isFullscreen } from "./note.js";

canvas.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".note")) return;
  if (e.button === 1 || isPanGesture(e)) {
    e.preventDefault();
    beginPan(e);
    return;
  }
  if (e.button === 0) beginPan(e);
});

canvas.addEventListener("dblclick", (e) => {
  if (e.target.closest(".note") || isFullscreen()) return;
  if (didJustPan()) return;
  const { x, y } = screenToWorld(e.clientX, e.clientY);
  createNote(x, y);
});

document.getElementById("toggle-dates").addEventListener("click", () => {
  setShowDates(!document.body.classList.contains("show-dates"));
});

initPanZoom();

openDB()
  .then(() => Promise.all([getAll(NOTES), getOne(META, "view"), getOne(META, "prefs")]))
  .then(([records, savedView, prefs]) => {
    if (savedView) setView(savedView);
    else applyView();

    setShowDates(!!(prefs && prefs.showDates), false);
    records.forEach(loadNote);
    setShowDates(!!(prefs && prefs.showDates), false);
    updateHint();
  })
  .catch((err) => console.error("Easy Note failed to start:", err));
