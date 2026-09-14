// Floating notes — the half that lives outside any page.
//
// A floating note is drawn on a webpage by the extension's own page, float.html,
// in a frame (see float/page.js). That page is the extension's origin: it reads
// and writes the note itself, with the board's own code. What is left for the
// worker is what no page can do — the right-click menu, putting the content
// script on pages at all, and telling pages already open that the set of
// floating notes has changed.
//
// Like the clipper, nothing here runs on a page until the user asks: the
// content script is registered only while at least one note is floating, and
// the host permission it needs is optional and requested at that moment.

import { openOnce, getAll, getOne, put, NOTES, META, FLOAT_TOKEN } from "../db.js";
import { ensureTray } from "../clip/save.js";
import { DEFAULT_WIDTH, DEFAULT_HEIGHT } from "./geometry.js";

const MENU_ID = "easynote-float";
const SCRIPT_ID = "easynote-float-overlay";
const FRAMES = "js/float/frames.js";

// A selection long enough to be a document rather than a note. The clipper
// caps what it stores for the same reason: the note has to stay a note.
const MAX_TEXT = 20000;

const newId = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const escapeHtml = (text) =>
  String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/* ------------------------------------------------------------------ menu */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create(
    {
      id: MENU_ID,
      title: "Add floating note",
      contexts: ["page", "selection"],
    },
    // The clipper's own menu is created in the same breath by its half of the
    // worker; a duplicate id here would be an unhandled error rather than a
    // no-op, and the two halves must not have to know about each other.
    () => void chrome.runtime.lastError
  );
  // An update while notes were floating leaves the dynamic registration behind
  // with the old worker. Put it back the way the records say it should be.
  syncRegistration().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  frameToken({ fresh: true }).catch(() => {});
  syncRegistration().catch(() => {});
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  createFloating(info, tab).catch((err) => console.warn("Easy Note:", err));
});

/* -------------------------------------------------------------- creating */

// A note made from a webpage lands in the Capture tray, the same as a clip.
//
// Exported for the same reason saveClip is: it touches nothing but the database
// and the tab it came from, so it can be exercised against a real database
// without a context-menu click to set it off.
// It came from out there and nobody has said where it belongs yet — dropping it
// into empty space on a board the user is not looking at would be making that
// decision for them, and making it badly, since the note would then be filed
// somewhere they never chose and have no reason to look.
export async function createFloating(info, tab) {
  await openOnce();
  const pageId = await ensureTray();
  const records = (await getAll(NOTES)).filter((n) => !n.deleted);
  const now = Date.now();
  const text = (info.selectionText || "").slice(0, MAX_TEXT).trim();

  const note = {
    id: newId(),
    // The tray is a filmstrip, so these are only what the note will be once it
    // is dragged onto a board — the drop point overwrites them. Same as a clip.
    x: 0,
    y: 0,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    html: text ? textToHtml(text, info.pageUrl) : "",
    color: "transparent",
    z: records.reduce((top, n) => Math.max(top, n.z || 0), 0) + 1,
    locked: false,
    createdAt: now,
    editedAt: now,
    updatedAt: now,
    pageId,
    floating: true,
    // Left unset: the page is the first thing that knows how big the viewport
    // the note has to sit in actually is, and it clamps against that.
    floatingGeometry: null,
  };
  await put(NOTES, note);

  await syncRegistration();
  await announce();
  // The tab that asked may have loaded before the script was ever registered,
  // so it has nothing on it to be told about this. Inject into it directly
  // rather than leaving the gesture looking like it did nothing.
  const shown = tab && tab.id != null ? await injectNow(tab.id) : false;
  // And every other page the user has open, so the note is on all of them and
  // not only the one they happened to right-click.
  await spread();
  // The new tab page is not open, so there is nothing else on screen to say
  // this worked. A page that cannot take the frame — chrome://, the PDF viewer
  // — says so rather than looking like the click did nothing: the note was
  // still made, and it is on the board waiting.
  if (shown) await flashBadge("＋", "#3d84d6", "Floating note added");
  else await flashBadge("—", "#8a8a8a", "Note saved to Easy Note — this page can't show it");
}

const BADGE_MS = 2000;

async function flashBadge(text, color, title) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  await chrome.action.setTitle({ title });
  setTimeout(() => {
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle({ title: "Easy Note" });
  }, BADGE_MS);
}

// Paragraph per line, matching what the board does with pasted text. Followed
// by where it was taken from, the way a clip says where it came from.
function textToHtml(text, url) {
  const body = text
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const safe = /^https?:\/\//i.test(url || "") ? url : "";
  if (!safe) return body;
  return `${body}<p><a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${escapeHtml(safe)}</a></p>`;
}

/* ------------------------------------------------------- serving the page */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string" || !msg.type.startsWith("easynote:float-")) return undefined;
  handle(msg).then(
    (result) => sendResponse(result),
    (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
  );
  return true; // the response is async
});

async function handle(msg) {
  await openOnce();
  switch (msg.type) {
    case "easynote:float-list":
      return { ok: true, notes: await floatingNotes(), token: await frameToken() };
    case "easynote:float-sync":
      // The board floated or un-floated something by writing straight into
      // IndexedDB, which this worker cannot see happen. It says so instead, and
      // this is how a page that is already open finds out it has a frame to add
      // or one to take away.
      await syncRegistration();
      if (msg.spread) await spread();
      await announce();
      return { ok: true };
    default:
      return { ok: false, error: "unknown" };
  }
}

// Which notes are floating and where, and nothing else. The content script
// that asks runs in the page's own document, so whatever it is handed the page
// can read: a note's words reach a page only inside a frame of our own origin.
async function floatingNotes() {
  const records = (await getAll(NOTES)).filter((n) => n.floating && !n.deleted);
  return records.map((note) => ({ id: note.id, floatingGeometry: note.floatingGeometry || null }));
}

/**
 * The secret a frame is let in with.
 *
 * float.html has to be reachable from every site to be framed on one, so any
 * site can frame it; what it will not do is draw a note for them. It draws for
 * whoever brings this, which only the content script is ever handed and only
 * the extension's own origin can read back. Kept in the database, since the
 * worker does not live long enough to remember anything, and made afresh each
 * time the browser starts.
 */
let token = null;
function frameToken({ fresh = false } = {}) {
  if (fresh || !token) {
    token = (async () => {
      await openOnce();
      const known = fresh ? null : await getOne(META, FLOAT_TOKEN).catch(() => null);
      if (known && known.value) return known.value;
      const value = newId();
      await put(META, { id: FLOAT_TOKEN, value });
      return value;
    })().catch((err) => {
      token = null;
      throw err;
    });
  }
  return token;
}

/* ----------------------------------------------------------- registration */

// The script is on every page the user visits or on none of them, and which it
// is follows from whether anything is floating. A profile that never floats a
// note never grants host access and never has a script on a page — which is
// the permission story the clipper established and this feature has to keep.
export async function syncRegistration() {
  await openOnce();
  const any = (await getAll(NOTES)).some((n) => n.floating && !n.deleted);
  const granted = await chrome.permissions.contains({ origins: ["<all_urls>"] }).catch(() => false);
  const registered = (await chrome.scripting.getRegisteredContentScripts().catch(() => [])).some(
    (s) => s.id === SCRIPT_ID
  );

  if (any && granted && !registered) {
    await chrome.scripting
      .registerContentScripts([
        {
          id: SCRIPT_ID,
          js: [FRAMES],
          matches: ["<all_urls>"],
          runAt: "document_idle",
          // Top frame only. A note inside an iframe would be trapped in its box,
          // and every frame on the page would draw one of its own.
          allFrames: false,
        },
      ])
      .catch(() => {});
    return;
  }
  if ((!any || !granted) && registered) {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }).catch(() => {});
  }
}

// A page already open has nothing on it: registering a content script only
// affects the loads that come after it. So it is injected directly.
async function injectNow(tabId) {
  const granted = await chrome.permissions.contains({ origins: ["<all_urls>"] }).catch(() => false);
  if (!granted) return false;
  return chrome.scripting
    .executeScript({ target: { tabId, frameIds: [0] }, files: [FRAMES] })
    .then(() => true)
    .catch(() => false);
}

/**
 * Put the frames on every page that is already open.
 *
 * Floating a note on the board and then having to reload the tab you were
 * reading to see it is not floating — the note is supposed to already be
 * there. Injecting twice is harmless: the script notices itself and catches up
 * rather than stacking a second copy.
 *
 * Only http(s). Everything else — chrome://, the store, the PDF viewer — will
 * refuse the script, and there is nothing useful to say about it here: the note
 * is on the board either way, and the next ordinary page will show it.
 */
async function spread() {
  const granted = await chrome.permissions.contains({ origins: ["<all_urls>"] }).catch(() => false);
  if (!granted) return;
  const tabs = await chrome.tabs.query({}).catch(() => []);
  await Promise.all(
    tabs
      .filter((tab) => tab.id != null && /^https?:\/\//i.test(tab.url || ""))
      .map((tab) => injectNow(tab.id))
  );
}

/**
 * Tell everyone who shows floating notes that which notes those are has changed.
 *
 * Twice, because they are two different kinds of listener and one call does not
 * reach both. `runtime.sendMessage` goes to the extension's own pages — an open
 * board. A content script does not hear it at all, and has to be addressed
 * through its tab.
 */
async function announce() {
  const message = { type: "easynote:float-changed" };
  chrome.runtime.sendMessage(message).catch(() => {});

  const tabs = await chrome.tabs.query({}).catch(() => []);
  await Promise.all(
    tabs
      .filter((tab) => tab.id != null && /^https?:\/\//i.test(tab.url || ""))
      // A tab with no script on it answers with an error, which is not worth
      // hearing about: it simply has nothing of ours to tell.
      .map((tab) => chrome.tabs.sendMessage(tab.id, message).catch(() => {}))
  );
}

// A worker cannot be reached by a dynamic import — the HTML spec forbids
// import() inside one — and a context-menu click cannot be staged from a test.
// So the one thing a test needs to set off is named here, on the worker's own
// global scope. Nothing in the extension reads it; it is the same allowance
// saveClip's export makes, for the same reason.
self.easynoteFloat = { createFloating };

// The board asks for this when the user floats a note there: it is the board
// that has a window to ask the permission from, not the worker.
chrome.permissions.onAdded.addListener(() => syncRegistration().catch(() => {}));
chrome.permissions.onRemoved.addListener(() => syncRegistration().catch(() => {}));
