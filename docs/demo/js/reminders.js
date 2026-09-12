// Reminders.
//
// A reminder is a timestamp on the note and nothing else — no background
// worker, no notifications permission, nothing that outlives the tab. When the
// time passes the note starts wiggling, and it keeps wiggling until it is
// dismissed, because being due is worked out from the record rather than
// remembered by a timer. That is what makes it survive switching pages,
// opening a second tab, or closing the browser for the afternoon.

import { NOTES, getAll } from "./db.js";

const HOUR = 60 * 60000;
const DAY = 24 * HOUR;

// Six, spread out. The old list had four ways to say "later today" and no way
// to say "next week", so the choice was harder and less useful at once.
export const PRESETS = [
  { label: "In 15 minutes", ms: 15 * 60000 },
  { label: "In an hour", ms: HOUR },
  { label: "This evening", ms: 5 * HOUR },
  { label: "Tomorrow", ms: DAY },
  { label: "In 3 days", ms: 3 * DAY },
  { label: "In a week", ms: 7 * DAY },
];

// Often enough that "in 1m" is honest, rare enough to be free.
const TICK = 15000;

// Every note in the database carrying a reminder, not just the ones on screen:
// a page can only say it has something waiting if we know about notes that
// were never rendered.
let pending = [];
let listeners = [];

export function onReminderTick(fn) {
  listeners.push(fn);
}

export function tick() {
  listeners.forEach((fn) => fn());
}

export function isDue(note) {
  return !!(note && note.remindAt) && note.remindAt <= Date.now();
}

/** Re-read the reminders in the database. Cheap, and only on real events. */
export async function loadReminders() {
  const all = await getAll(NOTES);
  pending = all
    .filter((note) => !note.deleted && note.remindAt)
    .map(({ id, pageId, remindAt }) => ({ id, pageId, remindAt }));
  tick();
}

/** Fold one note's reminder into what we already know, without a re-read. */
export function trackReminder(note) {
  pending = pending.filter((entry) => entry.id !== note.id);
  if (note.remindAt && !note.deleted) {
    pending.push({ id: note.id, pageId: note.pageId, remindAt: note.remindAt });
  }
  tick();
}

/** Which pages are holding something that has come due. */
export function duePageIds() {
  const now = Date.now();
  return new Set(pending.filter((entry) => entry.remindAt <= now).map((entry) => entry.pageId));
}

/**
 * The notes on one page that have come due, oldest first.
 *
 * Ordered so that clicking a page's badge repeatedly walks them in the order
 * they came due rather than in whatever order the database handed them back.
 */
export function dueOnPage(pageId) {
  const now = Date.now();
  return pending
    .filter((entry) => entry.pageId === pageId && entry.remindAt <= now)
    .sort((a, b) => a.remindAt - b.remindAt)
    .map((entry) => entry.id);
}

export function dueCount() {
  const now = Date.now();
  return pending.filter((entry) => entry.remindAt <= now).length;
}

/** How the reminder reads next to the last-edited time. */
export function remindLabel(remindAt) {
  if (!remindAt) return "";
  const left = remindAt - Date.now();
  if (left <= 0) return "due";

  const minutes = Math.round(left / 60000);
  if (minutes < 1) return "in a moment";
  if (minutes < 60) return `in ${minutes}m`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `in ${hours}h ${rest}m` : `in ${hours}h`;

  const days = Math.round(hours / 24);
  return days === 1 ? "tomorrow" : `in ${days}d`;
}

/** The value a datetime-local input wants, an hour from now. */
export function defaultCustomTime() {
  const at = new Date(Date.now() + 60 * 60000);
  at.setSeconds(0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export function initReminders() {
  setInterval(tick, TICK);
}
