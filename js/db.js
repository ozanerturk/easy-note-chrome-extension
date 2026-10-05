const DB_NAME = "easynote";
const DB_VERSION = 5;

export const NOTES = "notes";
export const IMAGES = "images";
export const META = "meta";
export const PAGES = "pages";
export const LISTS = "lists";

// The Capture tray is a page like any other — same store, same sync, same
// notes — reserved by a fixed id rather than by a schema of its own. Fixed so
// that two devices syncing their captures agree on which page that is; named
// here beside the stores because both the board and the service worker that
// writes clips need to know the id, and they share nothing else.
export const TRAY_ID = "capture-tray";

// Where the secret a floating note's frame is let in with is kept — see
// frameToken in float/background.js. The worker writes it and the frame reads
// it, and the database is the one thing the two of them share.
export const FLOAT_TOKEN = "floatToken";

let db;
// Callers such as the sync panel run before boot has finished opening the
// database, so every helper waits on this rather than touching a null handle.
let markReady;
const ready = new Promise((resolve) => {
  markReady = resolve;
});

function conn() {
  return db ? Promise.resolve(db) : ready;
}

export function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const upgraded = req.result;
      [NOTES, IMAGES, META, PAGES, LISTS].forEach((store) => {
        if (!upgraded.objectStoreNames.contains(store)) {
          upgraded.createObjectStore(store, { keyPath: "id" });
        }
      });
    };
    // Every new tab opens this database, so an upgrade can easily find an
    // older connection still open elsewhere. Without these two handlers the
    // upgrading tab waits forever on a blank canvas.
    req.onblocked = () => {
      console.warn("Easy Note: waiting for another tab to release the database…");
    };
    req.onsuccess = () => {
      db = req.result;
      db.onversionchange = () => {
        db.close();
        location.reload();
      };
      markReady(db);
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

// The service worker has no boot sequence to open the database for it, and can
// be woken for a clip and a reminder in the same breath. One connection per
// wake, whoever asks first.
let opening = null;
export const openOnce = () => (opening ||= openDB());

export async function getAll(store) {
  const d = await conn();
  return new Promise((resolve, reject) => {
    const req = d.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getOne(store, key) {
  const d = await conn();
  return new Promise((resolve, reject) => {
    const req = d.transaction(store, "readonly").objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function put(store, value) {
  const d = await conn();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Write a record, keeping some of its fields as the database already has them.
 *
 * For a writer whose copy of a record can be behind on fields that are not its
 * to change: a note floating over a webpage owns its words, not which page it
 * is filed on — and writing its whole copy back undid a move made on the board.
 * Read and write happen in one transaction, so nothing lands in between.
 *
 * @returns the record as written
 */
export async function putKeeping(store, value, keep) {
  const d = await conn();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    let written = value;
    const req = os.get(value.id);
    req.onsuccess = () => {
      const current = req.result;
      if (current) {
        written = { ...value };
        keep.forEach((key) => {
          if (key in current) written[key] = current[key];
          else delete written[key];
        });
      }
      os.put(written);
    };
    tx.oncomplete = () => resolve(written);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Change some fields of a stored record and leave the rest as they are, read
 * and written in one transaction. For a record whose live copy is somewhere
 * else entirely.
 *
 * @returns the record as written, or null if there was none
 */
export async function patch(store, key, fields) {
  const d = await conn();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    let written = null;
    const req = os.get(key);
    req.onsuccess = () => {
      if (!req.result) return;
      written = { ...req.result, ...fields };
      os.put(written);
    };
    tx.oncomplete = () => resolve(written);
    tx.onerror = () => reject(tx.error);
  });
}

export async function del(store, key) {
  const d = await conn();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function delMany(store, keys) {
  if (!keys.length) return;
  const d = await conn();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, "readwrite");
    const objectStore = tx.objectStore(store);
    keys.forEach((key) => objectStore.delete(key));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
