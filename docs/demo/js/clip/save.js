// Writes a clipped region into the board's database.
//
// This runs in the service worker, which shares the extension origin with the
// new tab page and therefore the same IndexedDB. It deliberately does not
// import note.js or pages.js: those reach for the DOM the moment they load, so
// the small amount of schema knowledge a clip needs is restated here instead.

import { openDB, getAll, put, NOTES, IMAGES, PAGES, TRAY_ID } from "../db.js";

const MIN_WIDTH = 200;
const MAX_WIDTH = 520;
const MIN_HEIGHT = 150;
const MAX_HEIGHT = 640;
// Body padding plus the image's own margins plus the line the source link
// sits on. Rough by nature — the note is resizable — but close enough that a
// clip does not arrive already scrolling.
const CHROME_HEIGHT = 76;
const BODY_PADDING = 24;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// The worker can be woken for several clips before it is shut down again, and
// openDB() hands back a fresh connection every call. One per wake is enough.
let connecting = null;
const connect = () => (connecting ||= openDB());

const newId = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const escapeHtml = (text) =>
  String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/**
 * Store the cropped image and the note that shows it.
 *
 * `width`/`height` are the crop in captured device pixels and `scale` is how
 * many of those go to a CSS pixel, so the note can be sized to how big the
 * region looked on the page rather than to how many pixels the screen used.
 */
export async function saveClip({ blob, width, height, scale, url, title }) {
  await connect();

  const imgId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await put(IMAGES, { id: imgId, blob });

  const pageId = await ensureTray();
  const cssWidth = Math.max(1, width / scale);
  const cssHeight = Math.max(1, height / scale);
  const noteWidth = clamp(Math.round(cssWidth) + BODY_PADDING, MIN_WIDTH, MAX_WIDTH);
  const shownHeight = ((noteWidth - BODY_PADDING) * cssHeight) / cssWidth;
  const noteHeight = clamp(Math.round(shownHeight + CHROME_HEIGHT), MIN_HEIGHT, MAX_HEIGHT);

  const records = (await getAll(NOTES)).filter((n) => !n.deleted);
  const now = Date.now();

  const note = {
    id: newId(),
    // The tray is a filmstrip, so these are only what the note will be when it
    // is dragged onto a board — the drop point overwrites them.
    x: 0,
    y: 0,
    width: noteWidth,
    height: noteHeight,
    html: clipHtml(imgId, url, title),
    color: "transparent",
    z: records.reduce((top, n) => Math.max(top, n.z || 0), 0) + 1,
    locked: false,
    createdAt: now,
    editedAt: now,
    updatedAt: now,
    pageId,
  };
  await put(NOTES, note);
  return note;
}

// The same markup a pasted image produces — `data-img-id` with no src, since
// the board resolves the blob at render time — followed by where it came from.
function clipHtml(imgId, url, title) {
  const safe = /^https?:\/\//i.test(url || "") ? url : "";
  const label = (title || "").trim() || safe || "Clipped page";
  const source = safe
    ? `<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
    : escapeHtml(label);
  return `<img data-img-id="${escapeHtml(imgId)}"><p>${source}</p>`;
}

// A capture lands in the Capture tray, never on a board. Landing it in empty
// space on a page the user is not looking at solves storing it and not finding
// it again — and it makes the "which page?" decision anyway, just deferred to
// whenever they stumble across it with the reason they grabbed it long gone.
//
// The tray is a reserved page. It is created on first use rather than at
// install, so a profile that never clips never grows one.
async function ensureTray() {
  const existing = (await getAll(PAGES)).find((p) => p.id === TRAY_ID);
  if (existing && !existing.deleted) return TRAY_ID;

  await put(PAGES, {
    id: TRAY_ID,
    name: "Captures",
    parentId: null,
    order: -1,
    collapsed: false,
    updatedAt: Date.now(),
  });
  return TRAY_ID;
}
