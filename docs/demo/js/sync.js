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

/**
 * One sync pass. Returns a summary of what moved.
 *
 * `drive` is injectable so the merge and image reconciliation can be exercised
 * against a fake, with no network and no Google account.
 */
export async function runSync({ drive = realDrive } = {}) {
  const files = await drive.list();
  const docFile = files.find((f) => f.name === DOC_NAME) || null;

  let remoteDoc = { notes: [], pages: [] };
  if (docFile) {
    try {
      remoteDoc = JSON.parse(await drive.downloadText(docFile.id));
    } catch (e) {
      throw new Error(`remote document unreadable: ${e.message}`);
    }
  }

  const [localNotes, localPages] = await Promise.all([getAll(NOTES), getAll(PAGES)]);
  const n = mergeById(localNotes, remoteDoc.notes || []);
  const p = mergeById(localPages, remoteDoc.pages || []);

  for (const rec of n.incoming) await put(NOTES, rec);
  for (const rec of p.incoming) await put(PAGES, rec);

  const images = await syncImages(drive, files, n.merged);

  if (!docFile || n.remoteStale || p.remoteStale || images.uploaded) {
    await drive.uploadJson({
      fileId: docFile ? docFile.id : undefined,
      name: DOC_NAME,
      data: { version: DOC_VERSION, notes: n.merged, pages: p.merged },
    });
  }

  const summary = {
    lastSyncedAt: Date.now(),
    pulledNotes: n.incoming.length,
    pulledPages: p.incoming.length,
    pushed: !docFile || n.remoteStale || p.remoteStale,
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
