// Mini-apps — a note that does something.
//
// A timer, a counter, whatever comes next: not a new kind of thing on the
// board, but a different renderer over the note record that is already there.
// The note is the app's storage. That is the whole design, and it is what buys
// drag, resize, colour, lock, list membership, filing, delete, undo of a move
// and Drive sync for the price of a mount function.
//
// Two rules come out of the fact that a note syncs as one atomic record
// (sync.js merges by `updatedAt`, last writer wins — there is no merging the
// insides of a note):
//
//   1. State is declarative, never ticking. A timer stores `endsAt`, never
//      `secondsLeft`. Reminders already work this way and for the same reason:
//      being due is worked out from the record rather than remembered by a
//      timer, which is what lets it survive a page switch, a second tab and a
//      laptop that was asleep.
//   2. Apps are single-writer and small. Two devices editing one app note is a
//      lost update, not a merge. Anything wanting concurrent editing wants its
//      own store, the way lists have one.
//
// Apps live under js/apps/ as first-party modules. No iframes, no eval: MV3's
// CSP forbids both, and the point here is that the app touches the same record
// as everything else — a bridge between an app and the thing it *is* would be
// all cost.

const apps = new Map();

/**
 * Add an app.
 *
 * @param {{
 *   name: string,        // stored on the note as `app`; never change one
 *   title: string,       // how the menu says it
 *   keywords?: string[], // [timer] typed into an empty note
 *   size?: {width: number, height: number},
 *   init?: () => object, // the state a fresh one starts with
 *   mount: (host: HTMLElement, api: object) => (Function|void),
 * }} app
 */
export function register(app) {
  apps.set(app.name, app);
}

export function appFor(name) {
  return (name && apps.get(name)) || null;
}

export function allApps() {
  return [...apps.values()];
}

// The keyword is a shortcut for the menu item, not the mechanism: it writes
// `note.app` and is never consulted again. Deciding what a note *is* by
// re-reading its words would make a note that merely mentions a timer into one,
// and would leave the app's identity at the mercy of the next sync.
//
// A whole line and nothing else, so "[timer]" in the middle of a sentence stays
// a word.
export function appForKeyword(text) {
  const match = String(text || "").trim().match(/^\[([a-z][a-z0-9-]*)\]$/i);
  if (!match) return null;
  const word = match[1].toLowerCase();
  return allApps().find((app) => (app.keywords || [app.name]).includes(word)) || null;
}

/* ------------------------------------------------------------------ ticker */

// One interval for the whole board. Thirty timers on a page should be one
// timer, not thirty — and an app that wants to redraw every second should not
// have to know that.
const TICK = 250;
const tickers = new Set();
let ticking = null;

function addTicker(fn) {
  tickers.add(fn);
  if (!ticking) ticking = setInterval(() => tickers.forEach((f) => f()), TICK);
}

function removeTicker(fn) {
  tickers.delete(fn);
  if (!tickers.size && ticking) {
    clearInterval(ticking);
    ticking = null;
  }
}

/* ------------------------------------------------------------------- mount */

// State writes are coalesced. Every write is a row that has to survive a merge
// and a line in the sync document, so an app holding a button down must not
// turn into a write per frame. Anything still pending is flushed on the way
// out, which is why unmount matters even for an app that looks idle.
const WRITE_DELAY = 400;

/**
 * Mount the app a note names into an element.
 *
 * @returns a handle with `unmount()`, or null if this build has no such app —
 *          a note synced from a newer version renders as an ordinary note
 *          rather than as nothing, and its state rides along untouched.
 */
export function mountApp(host, note, { save }) {
  const app = appFor(note.app);
  if (!app) return null;

  if (!note.state || typeof note.state !== "object") {
    note.state = app.init ? app.init() : {};
  }

  const mine = [];
  let pending = null;
  let dirty = false;

  const flush = () => {
    clearTimeout(pending);
    pending = null;
    if (!dirty) return;
    dirty = false;
    save(note);
  };

  const api = {
    note,
    get state() {
      return note.state;
    },
    /** Merge into the app's state and arrange for it to be written down. */
    setState(patch) {
      Object.assign(note.state, patch);
      dirty = true;
      if (!pending) pending = setTimeout(flush, WRITE_DELAY);
    },
    /** Write now — for state that must not be lost to a closing tab. */
    flush,
    /** Redraw on the shared ticker. Dropped automatically on unmount. */
    onTick(fn) {
      mine.push(fn);
      addTicker(fn);
    },
  };

  const teardown = app.mount(host, api);

  return {
    name: app.name,
    unmount() {
      mine.forEach(removeTicker);
      flush();
      if (typeof teardown === "function") teardown();
    },
  };
}
