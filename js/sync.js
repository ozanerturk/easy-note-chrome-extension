import { NOTES, PAGES, IMAGES, META, getAll, getOne, put } from "./db.js";
import { imageIdsIn } from "./note.js";
import * as realDrive from "./drive.js";

const DOC_NAME = "easynote.json";
const IMG_PREFIX = "img-";
const DOC_VERSION = 1;

/**
 * Last-write-wins per record, not per document — so two devices editing
 * different notes both keep their work. Tombstones take part like any other
 * record; that is the whole reason deletes are soft.
 *
 * Pure and DOM-free so it can be tested without Drive or a browser.
 */
export function mergeById(localList, remoteList) {
  const pairs = new Map();
  localList.forEach((r) => pairs.set(r.id, { local: r }));
  remoteList.forEach((r) => pairs.set(r.id, { ...(pairs.get(r.id) || {}), remote: r }));

  const merged = [];
  const incoming = []; // records to write into IndexedDB
  let remoteStale = false;

  for (const { local, remote } of pairs.values()) {
    if (local && !remote) {
      merged.push(local);
      remoteStale = true;
    } else if (!local && remote) {
      merged.push(remote);
      incoming.push(remote);
    } else {
      const lu = local.updatedAt || 0;
      const ru = remote.updatedAt || 0;
      if (ru > lu) {
        merged.push(remote);
        incoming.push(remote);
      } else {
        merged.push(local);
        if (lu > ru) remoteStale = true;
      }
    }
  }
  return { merged, incoming, remoteStale };
}

export async function getSyncMeta() {
  return (await getOne(META, "sync")) || {};
}

// Which stores go up and down. Notes and pages were written out by hand twice
// each — a merge, a write-back, a key in the document, a line in the summary —
// so a third kind of record meant four more edits in here and one in the panel
// that reports it. A store registers instead, and the pass below loops.
//
// The store's name is its key in the remote document, which is what the two
// original stores already used, so nothing about the file on Drive changes.
const syncedStores = [NOTES, PAGES];

export function registerSyncedStore(name) {
  if (!syncedStores.includes(name)) syncedStores.push(name);
}

/**
 * One sync pass. Returns a summary of what moved.
 *
 * `drive` is injectable so the merge and image reconciliation can be exercised
 * against a fake, with no network and no Google account.
 */
export async function runSync({ drive = realDrive } = {}) {
  const files = await drive.list();
  const docFile = files.find((f) => f.name === DOC_NAME) || null;

  let remoteDoc = {};
  if (docFile) {
    try {
      remoteDoc = JSON.parse(await drive.downloadText(docFile.id));
    } catch (e) {
      throw new Error(`remote document unreadable: ${e.message}`);
    }
  }

  // Every registered store, merged the same way. A store the remote document
  // has never heard of merges against nothing, which is exactly what should
  // happen the first time a new kind of record syncs.
  const results = {};
  const pulled = {};
  for (const store of syncedStores) {
    const result = mergeById(await getAll(store), remoteDoc[store] || []);
    for (const rec of result.incoming) await put(store, rec);
    results[store] = result;
    pulled[store] = result.incoming.length;
  }

  // Images hang off the notes that mention them, so that one store's merge is
  // the only one this needs by name.
  const images = await syncImages(drive, files, results[NOTES].merged);

  const stale = syncedStores.some((store) => results[store].remoteStale);
  if (!docFile || stale || images.uploaded) {
    const data = { version: DOC_VERSION };
    syncedStores.forEach((store) => {
      data[store] = results[store].merged;
    });
    await drive.uploadJson({
      fileId: docFile ? docFile.id : undefined,
      name: DOC_NAME,
      data,
    });
  }

  const summary = {
    lastSyncedAt: Date.now(),
    pulled,
    pushed: !docFile || stale,
    imagesUp: images.uploaded,
    imagesDown: images.downloaded,
    imagesRemoved: images.removed,
  };
  await put(META, { id: "sync", ...summary });
  return summary;
}

// Images are immutable once written, so their id is enough to identify them
// and there is never anything to merge — only to copy in whichever direction
// is missing.
async function syncImages(drive, files, mergedNotes) {
  const needed = new Set(
    mergedNotes.filter((n) => !n.deleted).flatMap((n) => imageIdsIn(n.html))
  );
  // Tombstones keep their markup, so an image they mention is still spoken for
  // until the tombstone itself is purged. Anything outside this set is
  // referenced by nothing at all and is safe to drop from Drive.
  const referenced = new Set(mergedNotes.flatMap((n) => imageIdsIn(n.html)));

  const remote = new Map(
    files
      .filter((f) => f.name.startsWith(IMG_PREFIX))
      .map((f) => [f.name.slice(IMG_PREFIX.length), f.id])
  );
  const local = new Set((await getAll(IMAGES)).map((i) => i.id));

  let uploaded = 0;
  let downloaded = 0;
  let removed = 0;

  for (const id of needed) {
    if (local.has(id) && !remote.has(id)) {
      const rec = await getOne(IMAGES, id);
      if (!rec) continue;
      await drive.upload({ name: IMG_PREFIX + id, blob: rec.blob });
      uploaded++;
    } else if (!local.has(id) && remote.has(id)) {
      const blob = await drive.downloadBlob(remote.get(id));
      await put(IMAGES, { id, blob });
      downloaded++;
    }
  }

  for (const [id, fileId] of remote) {
    if (referenced.has(id)) continue;
    await drive.remove(fileId).catch(() => {});
    removed++;
  }

  return { uploaded, downloaded, removed };
}
