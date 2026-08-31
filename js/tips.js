// Pointing out what the app can do, to people who have not found it yet.
//
// The whole design here is restraint. This is a tool for people who are easily
// pulled off task, so a tip that interrupts is worse than a feature never
// discovered. The rules it holds itself to:
//
//   - one tip per session, and never in the first few seconds
//   - never twice about the same thing in the same week
//   - at most three showings of any one tip, ever
//   - nothing at all until there are notes on the board — somebody still
//     working out what the app is does not need to hear about shortcuts
//   - the moment a feature is used, its tip is retired for good
//
// It reuses the toast, so a tip is one line that fades on its own. There is
// nothing to dismiss, nothing to click, and no badge left behind.

import { getPref, setPref } from "./prefs.js";
import { toast } from "./toast.js";

const DELAY_MS = 12000; // let them arrive and do what they came to do first
const REST_DAYS = 6; // between any two tips
const MAX_SHOWS = 3; // per tip, then it gives up
const MIN_NOTES = 3; // enough that the board is genuinely in use
const READ_MS = 7000; // a sentence with a shortcut in it takes a moment

// Ordered by how much they change the day if you did not know them.
const TIPS = [
  { key: "clip", text: "Tip: ⌥⇧S grabs any part of a web page straight into your tray." },
  { key: "search", text: "Tip: ⌘F searches every note on every page." },
  { key: "filing", text: "Tip: drag a note onto a page in the sidebar to file it there." },
  { key: "reminder", text: "Tip: right-click a note to have it nudge you later." },
  { key: "homeview", text: "Tip: hold the 🏠 button to set where this page opens." },
  { key: "fullscreen", text: "Tip: right-click a note and pick Fullscreen to write without the board." },
  { key: "colour", text: "Tip: right-click a note to give it a colour." },
  { key: "blur", text: "Tip: Alt+B blurs every note, for sharing your screen." },
];

const usedKey = (key) => `used:${key}`;
const shownKey = (key) => `shown:${key}`;

/**
 * Record that somebody used a feature, which retires its tip.
 *
 * Safe to call on every use: it writes only the first time.
 */
export function markUsed(key) {
  if (getPref(usedKey(key))) return;
  setPref(usedKey(key), true);
}

function pick() {
  return TIPS.find(
    (tip) => !getPref(usedKey(tip.key)) && (getPref(shownKey(tip.key), 0) || 0) < MAX_SHOWS
  );
}

/**
 * Consider showing one tip, once, a while after the board has settled.
 *
 * @param noteCount how many notes the profile actually has
 */
export function initTips(noteCount) {
  if (noteCount < MIN_NOTES) return;

  const last = getPref("lastTipAt", 0) || 0;
  if (Date.now() - last < REST_DAYS * 24 * 3600 * 1000) return;

  const tip = pick();
  if (!tip) return; // they have found everything, or heard enough about it

  setTimeout(() => {
    // Checked again on the way out: they may have used the very thing this
    // was about to explain in the twelve seconds since.
    if (getPref(usedKey(tip.key))) return;
    toast(tip.text, READ_MS);
    setPref(shownKey(tip.key), (getPref(shownKey(tip.key), 0) || 0) + 1);
    setPref("lastTipAt", Date.now());
  }, DELAY_MS);
}
