// What the system should be told about reminders, worked out from the records.
//
// Pure, so it can be tested without a browser: the worker hands it every note
// and the reminders this device has already announced, and gets back what to
// put up, what to take down, and when to wake next.

/**
 * `shown` maps a note id to the remindAt it was announced for. It is null on
 * the very first run, which takes whatever is already due as read: those notes
 * have been wiggling on the board for as long as they have been due, and a
 * stack of notifications for them the moment the extension updates would be
 * news about nothing.
 */
export function planNotices(notes, shown, now, { canShow = true } = {}) {
  const live = notes.filter((n) => !n.deleted && n.remindAt);
  const due = live.filter((n) => n.remindAt <= now).sort((a, b) => a.remindAt - b.remindAt);

  let next = null;
  live.forEach((n) => {
    if (n.remindAt > now && (next === null || n.remindAt < next)) next = n.remindAt;
  });

  // Only what is due now is worth remembering. A reminder dismissed on the
  // board, deleted, or moved into the future drops out of here by itself, and
  // is taken off the screen for the same reason.
  const nextShown = Object.fromEntries(due.map((n) => [n.id, n.remindAt]));
  if (!shown) return { show: [], clear: [], shown: nextShown, next };

  // With no permission nothing is announced, so nothing new is written down
  // as announced either. The first reminder is set a moment before Chrome's
  // question is answered; marking it seen then would mean saying yes and
  // hearing nothing. What was announced before still drops out when it goes.
  if (!canShow) {
    const kept = Object.fromEntries(Object.entries(shown).filter(([id, at]) => nextShown[id] === at));
    return { show: [], clear: [], shown: kept, next };
  }

  // Keyed on the time as well as the note, so a reminder that is set again
  // after it was dismissed is news again.
  const show = due.filter((n) => shown[n.id] !== n.remindAt);
  const clear = Object.keys(shown).filter((id) => !(id in nextShown));
  return { show, clear, shown: nextShown, next };
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

// A notification has three lines or so, and a pasted address fills them with
// path and query before it says anything. The site's name is the part a
// person recognises; the note itself is one click away.
const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"]+/gi;

function siteOf(match) {
  const [, address, trailing] = /^(.*?)([.,;:!?)\]]*)$/.exec(match);
  try {
    return new URL(address).hostname.replace(/^www\./, "") + trailing;
  } catch (e) {
    return match;
  }
}

const cut = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/**
 * A note's markup as a notification's two lines: its first line, then the
 * rest run together.
 *
 * The worker has no DOM to parse with, so this is done with patterns. It only
 * has to be readable in a notification, not faithful.
 */
export function noticeText(html) {
  const lines = String(html || "")
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<\/(p|div|li|h[1-6]|blockquote|pre|tr)>|<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => ENTITIES[name])
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(URL_IN_TEXT, siteOf)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return { title: cut(lines[0] || "", 80), body: cut(lines.slice(1).join(" "), 180) };
}
