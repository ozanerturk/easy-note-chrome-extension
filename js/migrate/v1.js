// One-way import of the published v1's notes into v3.
//
// Both versions ship under extension id hheobakelknbjicekbkmijjgcbephcef, so
// they share an origin and v3 can read v1's IndexedDB directly — no export
// file, no user action.
//
// v1's `notes` store holds exactly three records:
//   {id:"version",     value:"1.3.0"}
//   {id:"preferences", value:{…}}
//   {id:"default",     value:"<JSON string of the whole note array>"}
//
// The v1 database is opened read-only and is never written, cleared or
// deleted. A user who reverts to v1 must still find their notes, and a failed
// import has to be retryable.

import { NOTES, META, put, getOne, getAll } from "../db.js";
import { deltaToHtml, deltaToPlainText } from "./delta.js";

const V1_DB = "easy-note";
const V1_STORE = "notes";
const FLAG = "migratedFromV1";

// Exact backgrounds from v1's tab.css. Note v1 emits both `default` and
// `Default`, so lookups are lowercased.
export const THEME_COLORS = {
  default: "#fafafa",
  red: "#ff7d7d",
  green: "#67ee79",
  yellow: "#fff172",
  orange: "#ffba3c",
  teal: "#33cccc",
  navy: "#3333cc",
  olive: "#999933",
  maroon: "#cc3333",
  lime: "#33ff33",
  aqua: "#33ffff",
  fuchsia: "#ff33ff",
  silver: "#e0e0e0",
  gold: "#ffee33",
  gray: "#c0c0c0",
  brown: "#d2691e",
};

const DEFAULT_W = 240;
const DEFAULT_H = 180;

// indexedDB.open() *creates* a database that does not exist, so existence has
// to be checked first or every fresh install grows an empty `easy-note`.
async function v1Exists() {
  if (!indexedDB.databases) return true; // can't tell; opening below is still safe
  const dbs = await indexedDB.databases();
  return dbs.some((d) => d.name === V1_DB);
}

function openV1() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(V1_DB);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("v1 database is blocked by another tab"));
  });
}

function readAll(db) {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(V1_STORE)) return resolve([]);
    const req = db.transaction(V1_STORE, "readonly").objectStore(V1_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// v1 stored width as "" and height as null for any note never manually
// resized, so these cannot be copied across as-is.
function size(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function coord(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function convertNote(v1Note, index, pageId, now = Date.now()) {
  const html = deltaToHtml(v1Note.contents);
  return {
    // uniqueId is already a uuid, so it stays stable for sync.
    id: v1Note.uniqueId || `v1-${index}-${now}`,
    pageId,
    x: coord(v1Note.x),
    y: coord(v1Note.y),
    width: size(v1Note.width, DEFAULT_W),
    height: size(v1Note.height, DEFAULT_H),
    html,
    color: THEME_COLORS[String(v1Note.theme || "default").toLowerCase()] || THEME_COLORS.default,
    z: index + 1,
    locked: false,
    createdAt: now,
    editedAt: now,
    updatedAt: now,
    importedFrom: "v1",
  };
}

export function parseV1Notes(records) {
  const doc = records.find((r) => r.id === "default");
  if (!doc || !doc.value) return [];
  const parsed = typeof doc.value === "string" ? JSON.parse(doc.value) : doc.value;
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Import once. Safe to call on every boot.
 * `pageId` is where imported notes land.
 */
export async function migrateFromV1(pageId, { force = false } = {}) {
  const done = await getOne(META, FLAG);
  if (done && !force) return { skipped: "already migrated", imported: 0 };

  if (!(await v1Exists())) {
    await put(META, { id: FLAG, at: Date.now(), imported: 0, reason: "no v1 database" });
    return { skipped: "no v1 database", imported: 0 };
  }

  let db;
  try {
    db = await openV1();
    const records = await readAll(db);
    const version = (records.find((r) => r.id === "version") || {}).value || null;
    const preferences = (records.find((r) => r.id === "preferences") || {}).value || null;

    let v1Notes;
    try {
      v1Notes = parseV1Notes(records);
    } catch (e) {
      // Leave a trace and do not set the flag, so it can be retried rather
      // than silently starting the user on a blank canvas.
      await put(META, { id: "migrationError", at: Date.now(), message: e.message });
      return { error: `could not parse v1 notes: ${e.message}`, imported: 0 };
    }

    const existing = new Set((await getAll(NOTES)).map((n) => n.id));
    const now = Date.now();
    let imported = 0;
    let skippedEmpty = 0;

    for (let i = 0; i < v1Notes.length; i++) {
      const source = v1Notes[i];
      if (!deltaToPlainText(source.contents)) {
        skippedEmpty++;
        continue;
      }
      const note = convertNote(source, i, pageId, now);
      if (existing.has(note.id)) continue; // re-run safety
      await put(NOTES, note);
      imported++;
    }

    await put(META, {
      id: FLAG,
      at: now,
      imported,
      skippedEmpty,
      v1Version: version,
      v1Preferences: preferences,
      v1NoteCount: v1Notes.length,
    });

    return { imported, skippedEmpty, v1Version: version, total: v1Notes.length };
  } catch (e) {
    await put(META, { id: "migrationError", at: Date.now(), message: e.message });
    return { error: e.message, imported: 0 };
  } finally {
    if (db) db.close(); // read-only throughout; never written or deleted
  }
}
