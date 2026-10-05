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

/* ------------------------------------------------------------- reminders */

// Time zones without a library: Intl knows them, this just reads it.
export function validTimeZone(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function wallClock(ms, tz) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out = {};
  fmt.formatToParts(ms).forEach((p) => (out[p.type] = Number(p.value)));
  return out;
}

// how far the clock in `tz` is ahead of UTC at that instant
function offsetAt(ms, tz) {
  const c = wallClock(ms, tz);
  return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second) - Math.floor(ms / 1000) * 1000;
}

/** The instant midnight begins, in `tz`, `plusDays` days after the day `ms` falls on. */
export function startOfDay(ms, tz, plusDays = 0) {
  const c = wallClock(ms, tz);
  const wall = Date.UTC(c.year, c.month - 1, c.day + plusDays);
  // twice, so a day with a daylight-saving change in it still lands on midnight
  const first = wall - offsetAt(wall, tz);
  return wall - offsetAt(first, tz);
}

/** "2026-10-06 09:30" on the clock in `tz`. */
export function localString(ms, tz) {
  const c = wallClock(ms, tz);
  const p = (n) => String(n).padStart(2, "0");
  return `${c.year}-${p(c.month)}-${p(c.day)} ${p(c.hour)}:${p(c.minute)}`;
}

export const WHEN = ["today", "due", "upcoming", "all"];
const WEEK_DAYS = 8;

// Reminders are notes with a remindAt — dismissing one deletes it, so every one
// that is left is waiting. "today" is what is on your plate: everything that is
// already due plus whatever falls before tomorrow starts, which is what a
// morning briefing wants. Soonest first.
export function pickReminders(notes, { now, tz, when }) {
  const tomorrow = startOfDay(now, tz, 1);
  const weekEnd = startOfDay(now, tz, WEEK_DAYS);
  const keep = {
    today: (at) => at < tomorrow,
    due: (at) => at <= now,
    upcoming: (at) => at >= tomorrow && at < weekEnd,
    all: () => true,
  }[when];
  return notes
    .filter((n) => n.remindAt && keep(n.remindAt))
    .sort((a, b) => a.remindAt - b.remindAt)
    .map((note) => ({ note, due: note.remindAt <= now }));
}
