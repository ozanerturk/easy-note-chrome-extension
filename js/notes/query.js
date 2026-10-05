// What reading notes needs that has no DOM in it — shared by the search panel
// on the board and by the bridge in the service worker, which has no document
// to parse markup with.

// A picture's id as it appears in a note's markup.
export const imgIdsIn = (html) => [...String(html || "").matchAll(/data-img-id="([^"]+)"/g)].map((m) => m[1]);

// A picture's words, once read, are stored once as `ocr:<imageId>` in meta —
// see ocr.js. This turns those rows into image id -> text.
export function ocrMap(metaRows) {
  const byId = new Map();
  metaRows.forEach((r) => {
    if (typeof r.id === "string" && r.id.startsWith("ocr:") && r.text) byId.set(r.id.slice(4), r.text);
  });
  return byId;
}

/** "Work › Trips" — where a page sits. `pages` is id -> page record. */
export function pathFrom(pages, pageId) {
  const parts = [];
  let page = pages.get(pageId);
  while (page) {
    parts.unshift(page.name);
    page = page.parentId ? pages.get(page.parentId) : null;
  }
  return parts.join(" › ");
}

// A note has no title of its own; its first line is what it is called.
export function titleOf(text, max = 80) {
  const line = String(text || "").split("\n").find((l) => l.trim()) || "";
  const clean = line.trim();
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

// A window of text around the first place any term turns up, the start of the
// text when none does.
export function snippetAround(text, terms, max = 300) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  const hits = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0);
  const at = hits.length ? Math.min(...hits) : 0;
  const from = Math.max(0, at - 60);
  const body = flat.slice(from, from + max - 2);
  return (from ? "…" : "") + body + (from + max - 2 < flat.length ? "…" : "");
}
