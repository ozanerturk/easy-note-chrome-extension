const DB_NAME = "easynote";
const DB_VERSION = 4;

export const NOTES = "notes";
export const IMAGES = "images";
export const META = "meta";
export const PAGES = "pages";

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
      [NOTES, IMAGES, META, PAGES].forEach((store) => {
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
