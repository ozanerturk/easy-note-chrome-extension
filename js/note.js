import { NOTES, IMAGES, META, put, del, delMany, getOne, getAll } from "./db.js";
import { view, world, canvas } from "./view.js";
import { notes } from "./store.js";
import {
  isSelected,
  selectOnly,
  toggleSelect,
  selectedList,
  selected,
  forgetSelection,
} from "./selection.js";
import { currentPageId, setDraggedNotes, dropNotesAt } from "./pages.js";
import { setPref } from "./prefs.js";

export const COLORS = [
  "#fff6a3",
  "#ffd6d6",
  "#d6f5d6",
  "#d6e8ff",
  "#e6d6ff",
  "#ffe0bd",
  "#d3f2f0",
  "#ececec",
];

const overlay = document.getElementById("overlay");
const dragLayer = document.getElementById("drag-layer");
const hint = document.getElementById("hint");

export { notes };

const objectUrls = new Set();
let zCounter = 1;
let showDates = false;
let fullscreenEntry = null;

/* ----------------------------------------------------------------- helpers */

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

export function imageIdsIn(html) {
  const holder = document.createElement("div");
  holder.innerHTML = html || "";
  return [...holder.querySelectorAll("img[data-img-id]")].map((img) => img.dataset.imgId);
}

// Blob URLs are per-session, so persist only the id and re-resolve on load.
function serializeBody(body) {
  const clone = body.cloneNode(true);
  clone.querySelectorAll("img[data-img-id]").forEach((img) => img.removeAttribute("src"));
  return clone.innerHTML;
}

function hydrateImages(body) {
  body.querySelectorAll("img[data-img-id]").forEach((img) => {
    getOne(IMAGES, img.dataset.imgId).then((record) => {
      if (!record) return;
      const url = URL.createObjectURL(record.blob);
      objectUrls.add(url);
      img.src = url;
    });
  });
}

// `updatedAt` moves on every mutation because sync merges on it. `editedAt`
// only moves when the content changes, which is what the note footer shows.
function saveNote(note) {
  if (note.deleted) return;
  note.updatedAt = Date.now();
  put(NOTES, note).catch(() => {});
}

function formatDate(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const min = 60000, hour = 3600000, day = 86400000;
  if (diff < min) return "just now";
  if (diff < hour) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Older notes predate editedAt; fall back to updatedAt, then to the timestamp
// embedded in ids minted before uuids.
function timestampOf(note) {
  if (note.editedAt) return note.editedAt;
  if (note.updatedAt) return note.updatedAt;
  const parsed = parseInt(String(note.id).split("-")[0], 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function updateHint() {
  hint.style.display = notes.size ? "none" : "block";
}

export function nextZ() {
  return ++zCounter;
}

export function seedZ(value) {
  zCounter = Math.max(zCounter, value);
}

/* ------------------------------------------------------------------ dates */

export function setShowDates(value, persist = true) {
  showDates = value;
  document.body.classList.toggle("show-dates", showDates);
  document.getElementById("toggle-dates").classList.toggle("is-active", showDates);
  notes.forEach(({ note, el }) => refreshDate(note, el));
  if (persist) setPref("showDates", showDates);
}

/* ---------------------------------------------------------- privacy blur */

export function isBlurred() {
  return document.documentElement.classList.contains("blur-notes");
}

export function setBlurNotes(value, persist = true) {
  document.documentElement.classList.toggle("blur-notes", value);
  document.getElementById("toggle-blur").classList.toggle("is-active", value);
  document.getElementById("toggle-blur").title = value
    ? "Notes are blurred — click to reveal (Alt+B)"
    : "Blur notes for screen sharing (Alt+B)";
  if (!persist) return;
  // Mirrored synchronously so boot.js can blur before the first paint.
  try {
    localStorage.setItem("easynote:blurNotes", value ? "on" : "off");
  } catch (e) {
    /* ignore */
  }
  setPref("blurNotes", value);
}

function refreshDate(note, el) {
  const footer = el.querySelector(".note-date");
  if (footer) footer.textContent = formatDate(timestampOf(note));
}

export function refreshAllDates() {
  notes.forEach(({ note, el }) => refreshDate(note, el));
}

/* -------------------------------------------------------------- clipboard */

function insertAtCaret(node, body) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount || !body.contains(selection.anchorNode)) {
    body.appendChild(node);
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function handlePaste(event, note, el, body) {
  const data = event.clipboardData;
  if (!data) return;

  const images = [...data.items].filter(
    (item) => item.kind === "file" && item.type.startsWith("image/")
  );

  if (images.length) {
    event.preventDefault();
    images.forEach((item) => {
      const blob = item.getAsFile();
      if (!blob) return;
      const id = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      put(IMAGES, { id, blob }).then(() => {
        const img = document.createElement("img");
        img.dataset.imgId = id;
        const url = URL.createObjectURL(blob);
        objectUrls.add(url);
        img.src = url;
        insertAtCaret(img, body);
        touch(note, el, body);
      });
    });
    return;
  }

  // Paste text as plain text so foreign markup and styling never leak in.
  const text = data.getData("text/plain");
  if (text) {
    event.preventDefault();
    document.execCommand("insertText", false, text);
  }
}

function touch(note, el, body) {
  note.html = serializeBody(body);
  note.editedAt = Date.now();
  saveNote(note);
  refreshPlaceholder(body);
  refreshDate(note, el);
}

function refreshPlaceholder(body) {
  const blank = !body.textContent.trim() && !body.querySelector("img");
  body.classList.toggle("is-empty", blank);
}

/* ----------------------------------------------------------------- colours */

let openPalette = null;

function closePalette() {
  if (!openPalette) return;
  openPalette.remove();
  openPalette = null;
}

function showPalette(anchor, note, el) {
  closePalette();
  const palette = document.createElement("div");
  palette.className = "palette";
  COLORS.forEach((color) => {
    const dot = document.createElement("button");
    dot.className = "palette-dot";
    dot.style.background = color;
    dot.title = color;
    if (color === note.color) dot.classList.add("is-current");
    dot.addEventListener("click", (e) => {
      e.stopPropagation();
      note.color = color;
      el.style.background = color;
      saveNote(note);
      closePalette();
    });
    palette.appendChild(dot);
  });

  // Fixed position: a popover inside .note would be clipped by overflow:hidden.
  const rect = anchor.getBoundingClientRect();
  palette.style.left = `${rect.left}px`;
  palette.style.top = `${rect.bottom + 6}px`;
  document.body.appendChild(palette);
  openPalette = palette;

  requestAnimationFrame(() => {
    const box = palette.getBoundingClientRect();
    if (box.right > window.innerWidth - 8) {
      palette.style.left = `${window.innerWidth - box.width - 8}px`;
    }
  });
}

document.addEventListener("pointerdown", (e) => {
  if (openPalette && !e.target.closest(".palette") && !e.target.closest(".note-btn-color")) {
    closePalette();
  }
});

/* -------------------------------------------------------------- fullscreen */

export function isFullscreen() {
  return !!fullscreenEntry;
}

export function enterFullscreen(note, el) {
  if (fullscreenEntry) exitFullscreen();
  fullscreenEntry = {
    note,
    el,
    style: { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height },
  };
  note.fullscreen = true;
  el.classList.add("is-fullscreen");
  el.style.left = "";
  el.style.top = "";
  el.style.width = "";
  el.style.height = "";
  overlay.classList.add("is-active");
  overlay.appendChild(el);
  el.querySelector(".note-body").focus();
}

export function exitFullscreen() {
  if (!fullscreenEntry) return;
  const { note, el, style } = fullscreenEntry;
  el.classList.remove("is-fullscreen");
  el.style.left = style.left;
  el.style.top = style.top;
  el.style.width = style.width;
  el.style.height = style.height;
  world.appendChild(el);
  overlay.classList.remove("is-active");
  note.fullscreen = false;
  fullscreenEntry = null;
}

overlay.addEventListener("pointerdown", (e) => {
  if (e.target === overlay) exitFullscreen();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (openPalette) return closePalette();
    exitFullscreen();
  }
});

/* ------------------------------------------------------------------- notes */

export function newId() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createNote(worldX, worldY) {
  const note = {
    // uuid, so ids minted on different devices can never collide.
    id: newId(),
    x: worldX,
    y: worldY,
    width: 200,
    height: 150,
    html: "",
    color: COLORS[notes.size % COLORS.length],
    z: nextZ(),
    locked: false,
    createdAt: Date.now(),
    editedAt: Date.now(),
    updatedAt: Date.now(),
    pageId: currentPageId,
  };
  const el = renderNote(note);
  saveNote(note);
  updateHint();
  el.querySelector(".note-body").focus();
  return { note, el };
}

// Deletion writes a tombstone rather than removing the record. Without one,
// a delete cannot propagate and the note simply reappears from another device
// on the next sync. Images are kept until the tombstone is purged, since the
// note may still exist elsewhere.
export function deleteNote(note, el) {
  if (note.locked) return false;
  if (fullscreenEntry && fullscreenEntry.note === note) exitFullscreen();

  if (el.__observer) el.__observer.disconnect();
  el.remove();
  notes.delete(note.id);
  forgetSelection(note.id);

  note.deleted = true;
  note.deletedAt = Date.now();
  note.updatedAt = Date.now();
  put(NOTES, note).catch(() => {});

  updateHint();
  return true;
}

// Tombstones only need to outlive the window in which another device might
// still be holding the note. Past that they are dead weight, and so are the
// images they reference.
export async function purgeTombstones(maxAgeMs = 30 * 24 * 3600 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  const all = await getAll(NOTES);
  // A tombstone with no timestamp — e.g. written by an older or third-party
  // client — must never be treated as infinitely old, or it is destroyed on
  // the next boot. No timestamp means keep.
  const doomed = all.filter((n) => {
    if (!n.deleted) return false;
    const at = n.deletedAt || n.updatedAt;
    return at ? at < cutoff : false;
  });
  if (!doomed.length) return 0;

  const live = all.filter((n) => !n.deleted);
  const stillReferenced = new Set(live.flatMap((n) => imageIdsIn(n.html)));
  const orphanImages = doomed
    .flatMap((n) => imageIdsIn(n.html))
    .filter((id) => !stillReferenced.has(id));

  await delMany(IMAGES, orphanImages).catch(() => {});
  await Promise.all(doomed.map((n) => del(NOTES, n.id).catch(() => {})));
  return doomed.length;
}

// Land on a note the way clicking it would: raised above its neighbours and
// ready to type into.
export function activateNote({ note, el }) {
  bringToFront(note, el);
  const body = el.querySelector(".note-body");
  if (body) body.focus({ preventScroll: true });
}

function bringToFront(note, el) {
  note.z = nextZ();
  el.style.zIndex = note.z;
}

function applyLockUI(note, el) {
  el.classList.toggle("is-locked", !!note.locked);
  const lockBtn = el.querySelector(".note-btn-lock");
  const closeBtn = el.querySelector(".note-btn-close");
  lockBtn.textContent = note.locked ? "🔒" : "🔓";
  lockBtn.title = note.locked ? "Unlock note" : "Lock note (prevents deletion)";
  closeBtn.disabled = !!note.locked;
  closeBtn.title = note.locked ? "Locked — unlock to delete" : "Delete note";
}

export function renderNote(note) {
  const el = document.createElement("div");
  el.className = "note";
  el.style.left = `${note.x}px`;
  el.style.top = `${note.y}px`;
  el.style.width = `${note.width}px`;
  el.style.height = `${note.height}px`;
  el.style.background = note.color;
  el.style.zIndex = note.z;
  el.dataset.id = note.id;

  const header = document.createElement("div");
  header.className = "note-header";

  const left = document.createElement("div");
  left.className = "note-tools";

  const lockBtn = document.createElement("button");
  lockBtn.className = "note-btn note-btn-lock";

  const colorBtn = document.createElement("button");
  colorBtn.className = "note-btn note-btn-color";
  colorBtn.textContent = "◑";
  colorBtn.title = "Change colour";

  const expandBtn = document.createElement("button");
  expandBtn.className = "note-btn note-btn-expand";
  expandBtn.textContent = "⤢";
  expandBtn.title = "Fullscreen (Esc to exit)";

  const closeBtn = document.createElement("button");
  closeBtn.className = "note-btn note-btn-close";
  closeBtn.textContent = "×";

  left.append(lockBtn, colorBtn, expandBtn);
  header.append(left, closeBtn);

  const body = document.createElement("div");
  body.className = "note-body";
  body.contentEditable = "true";
  body.dataset.placeholder = "Type or paste here…";
  body.innerHTML = note.html || "";
  hydrateImages(body);
  refreshPlaceholder(body);

  const date = document.createElement("div");
  date.className = "note-date";
  date.textContent = formatDate(timestampOf(note));

  el.append(header, body, date);
  world.appendChild(el);

  notes.set(note.id, { note, el });

  /* behaviour */

  body.addEventListener("input", () => touch(note, el, body));
  body.addEventListener("paste", (e) => handlePaste(e, note, el, body));
  body.addEventListener("pointerdown", () => bringToFront(note, el));

  lockBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    note.locked = !note.locked;
    applyLockUI(note, el);
    saveNote(note);
  });

  colorBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    showPalette(colorBtn, note, el);
  });

  expandBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (note.fullscreen) exitFullscreen();
    else enterFullscreen(note, el);
  });

  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    deleteNote(note, el);
  });

  header.addEventListener("dblclick", (e) => {
    if (e.target.closest(".note-btn")) return;
    if (note.fullscreen) exitFullscreen();
    else enterFullscreen(note, el);
  });

  // Capture phase: the header's own pointerdown stops propagation, so a
  // bubbling listener here would never see clicks on the drag handle.
  el.addEventListener(
    "pointerdown",
    (e) => {
      if (note.fullscreen) return;
      if (e.shiftKey || e.metaKey || e.ctrlKey) toggleSelect(note.id);
      else if (!isSelected(note.id)) selectOnly(note.id);
    },
    true
  );

  makeDraggable(el, header, note);
  el.__observer = observeResize(el, note);

  applyLockUI(note, el);
  return el;
}

/* --------------------------------------------------------------- drag layer */

// While dragging, a note leaves #world for #drag-layer so it is not clipped by
// the canvas and floats above the sidebar. Position becomes screen-space, and
// the world's scale is reapplied per-note so its size does not jump.
function liftToDragLayer(entries) {
  const rect = canvas.getBoundingClientRect();
  entries.forEach(({ note, el }) => {
    el.style.transform = `scale(${view.zoom})`;
    el.style.left = `${rect.left + view.x + note.x * view.zoom}px`;
    el.style.top = `${rect.top + view.y + note.y * view.zoom}px`;
    dragLayer.appendChild(el);
  });
}

function positionInDragLayer(entries) {
  const rect = canvas.getBoundingClientRect();
  entries.forEach(({ note, el }) => {
    el.style.left = `${rect.left + view.x + note.x * view.zoom}px`;
    el.style.top = `${rect.top + view.y + note.y * view.zoom}px`;
  });
}

function returnToWorld(entries) {
  entries.forEach(({ note, el }) => {
    el.style.transform = "";
    el.style.left = `${note.x}px`;
    el.style.top = `${note.y}px`;
    if (el.isConnected) world.appendChild(el);
  });
}

function makeDraggable(el, handle, note) {
  handle.addEventListener("pointerdown", (e) => {
    // Buttons in the header must keep their click event: preventDefault() on
    // pointerdown suppresses the compatibility click that follows.
    if (e.target.closest(".note-btn")) return;
    if (note.fullscreen) return;

    e.preventDefault();
    e.stopPropagation(); // don't let the canvas start a pan or marquee
    bringToFront(note, el);

    const startX = e.clientX;
    const startY = e.clientY;

    // Dragging any member of a multi-selection moves the whole group.
    const group =
      isSelected(note.id) && selected.size > 1
        ? selectedList()
        : [{ note, el }];
    const anchored = group.map((entry) => ({
      ...entry,
      startLeft: entry.note.x,
      startTop: entry.note.y,
    }));

    let lifted = false;

    const onMove = (moveEvent) => {
      // Screen delta -> world delta.
      const dx = (moveEvent.clientX - startX) / view.zoom;
      const dy = (moveEvent.clientY - startY) / view.zoom;
      anchored.forEach((entry) => {
        entry.note.x = entry.startLeft + dx;
        entry.note.y = entry.startTop + dy;
      });

      if (!lifted && Math.hypot(dx * view.zoom, dy * view.zoom) > 3) {
        lifted = true;
        liftToDragLayer(anchored);
      }

      if (lifted) {
        positionInDragLayer(anchored);
      } else {
        anchored.forEach((entry) => {
          entry.el.style.left = `${entry.note.x}px`;
          entry.el.style.top = `${entry.note.y}px`;
        });
      }
    };

    setDraggedNotes(anchored.map((entry) => entry.note.id));

    const onUp = (upEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      dropNotesAt(upEvent.clientX, upEvent.clientY, detachNote).then((moved) => {
        if (moved) {
          updateHint();
          return; // the notes now live on another page
        }
        if (lifted) returnToWorld(anchored);
        anchored.forEach((entry) => saveNote(entry.note));
      });
    };

    // Window-level listeners rather than setPointerCapture: capture silently
    // failed to re-establish on repeat drags, stranding the note mid-gesture.
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}

function observeResize(el, note) {
  const observer = new ResizeObserver(() => {
    // Removal fires this with a 0x0 box; fullscreen fires it with the viewport
    // size. Neither is a real resize of the note.
    if (note.deleted || note.fullscreen || !el.isConnected) return;
    note.width = el.offsetWidth;
    note.height = el.offsetHeight;
    saveNote(note);
  });
  observer.observe(el);
  return observer;
}

/* ------------------------------------------------------------------- boot */

// Take a note off the canvas without touching its record — used when it moves
// to another page, and when switching pages.
export function detachNote(entry) {
  if (entry.el.__observer) entry.el.__observer.disconnect();
  entry.el.remove();
  notes.delete(entry.note.id);
  forgetSelection(entry.note.id);
}

export function clearBoard() {
  [...notes.values()].forEach(detachNote);
}

export function loadNote(record) {
  // v1 stored plain text under `text`; carry it over as escaped markup.
  if (record.html === undefined) record.html = escapeHtml(record.text || "");
  delete record.deleted;
  delete record.fullscreen;
  seedZ(record.z || 1);
  renderNote(record);
}

window.addEventListener("pagehide", () => {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls.clear();
});

setInterval(refreshAllDates, 60000);
