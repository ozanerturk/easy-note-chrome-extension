// A note floating over a webpage.
//
// This is an extension page, framed by js/float/frames.js on whatever site the
// user is reading. Being the extension's own origin is the whole point of it:
// it opens the same database the board does and draws the note with the same
// note.js, so a floating note is not a copy of a note that has to be taught
// everything a second time. Pictures, the editor and its formatting bar, apps,
// reminders — whatever a note can do on the board, it can do here.
//
// What this adds is a host (see note.js): where the note is put, and how it is
// moved, when there is no board to put it on. And one thing a frame forces on
// it. The frame covers the whole viewport, so the note and anything it opens —
// a menu, the formatting bar, the reminder picker — can go wherever they would
// go on the board. But a frame that size would take every click on the page,
// so the page clips it down to the note while the note is only being looked
// at, and lifts the clip while the pointer is on the note or on something it
// has opened. Chrome sends a click to whatever the clip leaves showing.
//
// The frame itself never moves or changes size. It used to shrink to the note
// and grow to the viewport instead, and for a frame or two after every change
// Chrome went on reading the pointer against where the frame had been — the
// pointer seemed to have left the note, the frame shrank back, and the note
// flickered between the two for as long as the pointer stayed on it.

import { openOnce, getOne, getAll, NOTES, META, FLOAT_TOKEN } from "../db.js";
import { loadPrefs } from "../prefs.js";
import { initReminders } from "../reminders.js";
import {
  renderNote,
  setNoteHost,
  saveNote,
  patchNote,
  clearActiveNote,
  dismissTopmost,
  editorFor,
  isTyping,
} from "../note.js";
import { caretAt } from "../editor.js";
import { unfloatNote, announceFloating } from "../floating.js";
import { clampBox, defaultBox, tuckedX, tuckedSpot, TUCK_TAB } from "./geometry.js";
import { ensureTray } from "../clip/save.js";

const id = new URL(location.href).searchParams.get("id");
const root = document.getElementById("float-root");
const overlay = document.getElementById("overlay");

// Where a note sits on its board, and in which list and page. None of it is
// this frame's to change, and its copy of them is whatever they were when it
// loaded — so a write from here leaves them as the database has them.
const BOARD_FIELDS = ["x", "y", "width", "height", "pageId", "listId", "listOrder", "z"];
// Below this a press on the note is a click, as it is on the board.
const DRAG_THRESHOLD = 3;
// The board's own smallest note — see .note in style.css.
const MIN_WIDTH = 160;
const MIN_HEIGHT = 40;
// The slide to the edge and back — .is-sliding in float.css.
const SLIDE_MS = 340;
// How long Escape is held to tuck away every floating note, not only this one.
const HOLD_MS = 500;
// Room around a tab for the shadow the holder draws — #float-root.has-tab.
const TAB_SHADOW = 12;

let port = null;
let note = null;
let el = null;
// Where the note floats, in the page's viewport pixels — which, the frame
// covering the viewport exactly, are this document's pixels too.
let box = null;
let clip;
let hovering = false;
let holding = false;
let sliding = false;
let slideTimer = null;
let slideClip = null;
let shownTucked = false;

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

// clampBox only promises a sliver stays reachable — enough that a note
// dragged almost off an edge is not lost for good, which is the right rule
// for a note already tucked there on purpose. An open note that no longer
// fits, because the window shrank under it or because it was just dragged
// past an edge, is not asking to be tucked — it is only asking not to hang
// half off the page. Whether it still fits at all, with nothing hanging off,
// is a stricter question than clampBox answers, and this is that question.
const fitsFully = (b, view) =>
  b.x >= 0 && b.y >= 0 && b.x + b.width <= view.width && b.y + b.height <= view.height;

// A frame can be running script before it has been given any size at all.
// Clamping against a viewport of nothing squeezed a note to a speck, pinned to
// the corner, for good — so a note is placed against a viewport that exists.
const laidOut = () =>
  new Promise((resolve) => {
    if (window.innerWidth && window.innerHeight) return resolve();
    const check = () => {
      if (!window.innerWidth || !window.innerHeight) return;
      window.removeEventListener("resize", check);
      resolve();
    };
    window.addEventListener("resize", check);
  });

/* -------------------------------------------------------------- handshake */

// Nothing is drawn until the content script says so, with a token only it and
// this origin know. float.html has to be reachable from every site to be framed
// at all, and without this any of them could frame it with a note's id in the
// address and have that note drawn inside their own page — to be covered,
// faded out or clicked through.
window.addEventListener("message", async (e) => {
  if (port || e.source !== window.parent) return;
  const hello = e.data;
  if (!hello || hello.type !== "easynote:float-hello" || !e.ports || !e.ports[0]) return;
  await openOnce();
  const known = await getOne(META, FLOAT_TOKEN).catch(() => null);
  if (port || !known || typeof hello.token !== "string" || hello.token !== known.value) return;
  start(e.ports[0], hello);
});

async function start(channel, hello) {
  port = channel;
  port.onmessage = (e) => heard(e.data || {});

  // Before anything can write a preference. The record is one object, and a
  // write from a cache that never read it would put back only what this frame
  // happened to know.
  await loadPrefs();
  note = await getOne(NOTES, id).catch(() => null);
  if (!note || note.deleted || !note.floating) return leave();
  delete note.fullscreen;

  await laidOut();
  box = clampBox(note.floatingGeometry || hello.box, viewport());
  setNoteHost(host);
  renderNote(note);
  // The same clock the board keeps, so a note that comes due while it floats
  // says so here too.
  initReminders();
  settle();
}

// The frame is done with: put away, deleted, or never this page's to show.
//
// Not the moment it is decided, though. Taking a frame off its page aborts the
// writes it still has open, and the one that says the note was put away or
// deleted is written a moment before this is called: the note came straight
// back, still floating, in a new frame. A read of the note waits behind this
// frame's own write to it, so once the read is in, the write is too.
let leaving = false;
async function leave() {
  if (!port || leaving) return;
  leaving = true;
  await getOne(NOTES, id).catch(() => null);
  port.postMessage({ type: "gone" });
}

function heard(msg) {
  if (msg.type === "away") {
    // A press somewhere on the page: clicking away from the note, the same as
    // clicking the board around it.
    clearActiveNote();
    settle();
  }
}

/* ------------------------------------------------------------------- host */

const host = {
  place(n, element) {
    el = element;
    root.appendChild(element);
    layout();
  },

  putBack(n, element) {
    root.appendChild(element);
    // Fullscreen is still being unwound when this is called.
    queueMicrotask(() => {
      layout();
      settle();
    });
  },

  wire(n, element, grip, gripLeft) {
    carry(element);
    stretch(grip, "se");
    stretch(gripLeft, "sw");
  },

  gang: (n, element) => [{ note: n, el: element }],

  // The note's own way back down, first and above the colours — the one
  // thing about a floating note that is about this being a floating note.
  // None of the board's rows — filing, gathering notes into a list — mean
  // anything in here, and there is no other board here to copy a note onto.
  menu: () => ({ top: [{ label: "Unfloat", run: putAway }], copy: false }),

  // Written somewhere else — moved in another tab, put away from the board.
  adopted(n) {
    if (n.deleted || !n.floating) return leave();
    if (!holding && n.floatingGeometry) box = clampBox(n.floatingGeometry, viewport());
    // Tucked away or brought back somewhere else — with every other note, say.
    if (JSON.stringify(n.floatingTucked || null) !== shownTucked) slide();
    else layout();
    settle();
  },

  // Escape on the open note: see the keyboard section.
  dismiss() {
    armEscape();
    return true;
  },

  // A note made from in here — a timer asked for with "/" — floats too: beside
  // this one, top edges level, or on its left when the right is out of room.
  // In Easy Note it waits in the Capture tray, the same as anything else made
  // out on a webpage. Nobody here has said which board it belongs on, and
  // putting it beside this note there would drop it on whatever is already
  // lying there, to be found later.
  async spawn(made) {
    const GAP = 16;
    const right = box.x + box.width + GAP;
    const x = right + made.width <= window.innerWidth ? right : box.x - GAP - made.width;
    made.floating = true;
    made.floatingGeometry = clampBox({ x, y: box.y, width: made.width, height: made.height }, viewport());
    made.pageId = await ensureTray();
    made.x = 0;
    made.y = 0;
    saveNote(made);
    // Once it is in the database, which is where the worker looks.
    getOne(NOTES, made.id)
      .then(() => announceFloating())
      .catch(() => {});
  },

  keeps: BOARD_FIELDS,
};

// To the side of the page and back. The note keeps its place — floatingGeometry
// is where it comes back to — and only a sliver of it stays showing.
let tucking = false;
async function tuck(on) {
  if (!el || tucking || !!note.floatingTucked === on) return;
  if (on) {
    clearActiveNote();
    if (!el.isConnected) return; // it was empty, and stepping out threw it away
    tucking = true;
    note.floatingTucked = tuckedSpot(box, viewport(), tabsTaken(await floatingRecords()));
    tucking = false;
  } else {
    delete note.floatingTucked;
  }
  slide();
  saveNote(note);
}

const floatingRecords = async () =>
  (await getAll(NOTES).catch(() => [])).filter((n) => n.floating && !n.deleted);

// Where the other tucked notes' tabs are, so a new one can keep clear of them.
const tabsTaken = (records) =>
  records.filter((n) => n.id !== id && n.floatingTucked && typeof n.floatingTucked === "object").map((n) => n.floatingTucked);

// Lay the note out where it now belongs, travelling there rather than jumping.
// The frame is left whole while it travels: a clip fitted to where it started
// would cut it off on the way.
function slide() {
  if (!el) return;
  const from = drawn();
  el.classList.add("is-sliding");
  sliding = true;
  layout();
  // Not the whole viewport: the page is still the page while a note goes by,
  // and a click on it mid-slide is its click. The frame keeps only the strip
  // the note travels through — where it was, where it is going, and between.
  const to = headedFor();
  slideClip = from && to ? union(from, to) : null;
  settle();
  clearTimeout(slideTimer);
  slideTimer = setTimeout(() => {
    el.classList.remove("is-sliding");
    sliding = false;
    slideClip = null;
    layout();
    settle();
  }, SLIDE_MS + 60);
}

function putAway() {
  clearActiveNote();
  unfloatNote(note, el);
  leave();
}

/* ------------------------------------------------------------------- clip */

function layout() {
  if (!el || !box || note.fullscreen) return;
  // A spot from an earlier build was only `true`; it is worked out afresh.
  const saved = note.floatingTucked;
  const spot = !saved ? null : typeof saved === "object" ? saved : tuckedSpot(box, viewport());
  const tucked = !!spot;
  const edge = tuckedX(box, window.innerWidth, spot && spot.side);
  const x = tucked ? edge.x : box.x;
  const y = tucked ? Math.max(0, Math.min(spot.y, window.innerHeight - TUCK_TAB)) : box.y;
  shownTucked = JSON.stringify(saved || null);
  el.classList.toggle("is-tucked", tucked);
  root.classList.toggle("has-tab", tucked);
  el.classList.toggle("tuck-left", tucked && edge.toLeft);
  el.classList.toggle("tuck-right", tucked && !edge.toLeft);
  el.title = tucked ? "Bring this note back" : "";
  // Only the top of it, as a tab. Opened out to its full height while it is
  // travelling, so the tab grows back into the note on the way home.
  el.style.clipPath = tucked ? `inset(0 0 calc(100% - ${TUCK_TAB}px) 0)` : sliding ? "inset(0 0 0px 0)" : "";
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.width = `${box.width}px`;
  el.style.height = `${box.height}px`;
}

// How far the note's shadow reaches past each of its edges. A flat margin cut
// the soft bottom of it off: a shadow dropped six pixels and blurred twenty
// reaches well past ten below the card, and hardly at all above it.
function shadowReach(element) {
  const reach = { top: 2, right: 2, bottom: 2, left: 2 };
  const value = getComputedStyle(element).boxShadow;
  if (!value || value === "none") return reach;
  for (const shadow of value.split(/,(?![^(]*\))/)) {
    if (/\binset\b/.test(shadow)) continue;
    const lengths = (shadow.replace(/rgba?\([^)]*\)/g, "").match(/-?[\d.]+px/g) || []).map(parseFloat);
    const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
    const r = blur + spread + 1;
    reach.top = Math.max(reach.top, r - y);
    reach.bottom = Math.max(reach.bottom, r + y);
    reach.left = Math.max(reach.left, r - x);
    reach.right = Math.max(reach.right, r + x);
  }
  return reach;
}

// Everything the note draws: the card and its shadow, the header that hangs
// above it while it is open, the line under it while there is a reminder.
function drawn() {
  const card = el.getBoundingClientRect();
  if (!card.width || !card.height) return null; // not laid out yet
  // Tucked, all there is of it is the tab, and the shadow around it.
  if (el.classList.contains("is-tucked")) {
    const x = Math.max(0, Math.floor(card.left) - TAB_SHADOW);
    const right = Math.min(window.innerWidth, Math.ceil(card.right) + TAB_SHADOW);
    const y = Math.max(0, Math.floor(card.top) - TAB_SHADOW);
    const bottom = Math.min(window.innerHeight, Math.ceil(card.top) + TUCK_TAB + TAB_SHADOW);
    return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
  }
  const reach = shadowReach(el);
  let left = card.left - reach.left;
  let top = card.top - reach.top;
  let right = card.right + reach.right;
  let bottom = card.bottom + reach.bottom;
  for (const part of el.querySelectorAll(":scope > .note-header, :scope > .note-footer")) {
    const style = getComputedStyle(part);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
    const r = part.getBoundingClientRect();
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  // Only what is on the page: a tucked note is mostly past its edge.
  const x = Math.max(0, Math.floor(left));
  const y = Math.max(0, Math.floor(top));
  return {
    x,
    y,
    width: Math.max(0, Math.min(window.innerWidth, Math.ceil(right)) - x),
    height: Math.max(0, Math.min(window.innerHeight, Math.ceil(bottom)) - y),
  };
}

// Where the note's layout says it is going, with room for its shadow: its box
// as styled rather than as drawn, since mid-transition it is drawn on the way.
function headedFor() {
  const left = parseFloat(el.style.left) || 0;
  const top = parseFloat(el.style.top) || 0;
  const width = parseFloat(el.style.width) || 0;
  const height = el.classList.contains("is-tucked") ? TUCK_TAB : parseFloat(el.style.height) || 0;
  const reach = shadowReach(el);
  const pad = Math.max(TAB_SHADOW, reach.top, reach.right, reach.bottom, reach.left);
  const x = Math.max(0, Math.floor(left - pad));
  const y = Math.max(0, Math.floor(top - pad));
  return {
    x,
    y,
    width: Math.max(0, Math.min(window.innerWidth, Math.ceil(left + width + pad)) - x),
    height: Math.max(0, Math.min(window.innerHeight, Math.ceil(top + height + pad)) - y),
  };
}

function union(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

// Only what can be seen counts: the table's controls, for one, are put on the
// body the moment the editor opens and stay there, empty, until a table is
// hovered — and an empty holder is no reason to take the page's clicks.
const opened = () =>
  [...document.body.children].some((child) => {
    if (child === root || child === overlay || child.tagName === "SCRIPT") return false;
    const style = getComputedStyle(child);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const r = child.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });

const same = (a, b) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);

// Tell the page how much of this frame to leave showing: all of it while the
// note is in use, and just the note otherwise.
function settle() {
  if (!el || !port) return;
  const full = holding || hovering || (sliding && !slideClip) || note.fullscreen || opened();
  const next = full ? null : sliding ? slideClip : drawn();
  if (!full && !next) return;
  if (clip !== undefined && same(next, clip)) return;
  clip = next;
  port.postMessage({ type: "clip", rect: next });
  // Read by the UI tests, the way main.js's data-ready is.
  document.documentElement.dataset.frame = full ? "whole" : "fitted";
}

new MutationObserver(settle).observe(document.body, { childList: true });
new MutationObserver(settle).observe(overlay, { attributes: true, attributeFilter: ["class"] });
// Deleted from its own menu, or taken off the page by adopting a delete.
new MutationObserver(() => {
  if (el && !el.isConnected) leave();
}).observe(root, { childList: true });

// The frame is the viewport, so the page being resized is this being resized.
window.addEventListener("resize", () => {
  if (!box || !window.innerWidth || !window.innerHeight) return;
  const view = viewport();
  if (!note.floatingTucked && !fitsFully(box, view)) {
    // The window shrank under it rather than it being dragged anywhere — the
    // note itself did not move, the world around it did. Tucking it to the
    // nearest edge is the same recovery Escape already offers: a sliver, a
    // peek on hover, one click back — not a corner of the card left hanging
    // off whichever edge the shrink caught it against.
    tuck(true);
    return;
  }
  box = clampBox(box, view);
  layout();
  settle();
});

/* ---------------------------------------------------------------- pointer */

// Whether the pointer is on anything of the note's. The frame's own ground is
// the page showing through, and being over it is being over the page.
const ground = (target) => target === document.documentElement || target === document.body || target === root;

function track(over) {
  if (over === hovering) return;
  hovering = over;
  settle();
}

document.addEventListener("pointerover", (e) => track(!ground(e.target)));
document.addEventListener("pointermove", (e) => track(!ground(e.target)));
document.documentElement.addEventListener("pointerleave", () => track(false));

// A tucked note is one thing only: a sliver that brings it back. A press on it
// does that and nothing else — no opening it, no picking it up, no menu. On the
// holder, in the capture phase, so the note's own handlers never hear it.
// On the tab itself, that is: the holder covers the whole viewport, so a press
// anywhere on the page while the frame was unclipped used to bring it back.
root.addEventListener(
  "pointerdown",
  (e) => {
    if (!note || !note.floatingTucked || e.button !== 0 || !el || !el.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    tuck(false);
  },
  true
);
root.addEventListener(
  "contextmenu",
  (e) => {
    if (!note || !note.floatingTucked || !el || !el.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
  },
  true
);

// A press on the page showing through, caught while the clip was off. It was
// meant for the page, which this frame cannot hand it to; the most it can do is
// step out of the note and out of the way of the next one.
document.addEventListener("pointerdown", (e) => {
  if (!ground(e.target)) return;
  clearActiveNote();
  track(false);
});

// The board's own rule for picking a note up — see makeDraggable in
// board-note.js. An idle note is a handle everywhere; a note being written in
// is text again, except at its margin; a press that never travels is a click,
// and puts the caret where it landed.
function carry(element) {
  element.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || note.fullscreen) return;
    if (e.target.closest(".note-btn")) return;
    if (e.target.closest('input[type="checkbox"], label')) return;
    if (e.target.closest(".note-body.is-app button, .note-body.is-app input")) return;
    const inBody = !!e.target.closest(".note-body");
    const onMargin = e.target.classList.contains("note-body");
    if (inBody && !onMargin && isTyping(element)) return;
    if (e.target.closest("a[href]")) return;
    e.preventDefault();

    follow(e, (start, dx, dy) => ({ ...start, x: start.x + dx, y: start.y + dy }), (up) => {
      if (!inBody) return;
      const editor = editorFor(note.id);
      if (editor) caretAt(editor, up.clientX, up.clientY);
    }, { tuckIfOffEdge: true });
  });
}

// "sw" mirrors "se": the left grip grows the note leftward, sliding `x` back
// by however much the (clamped) width actually grew, so the right edge holds
// still — same idea as the board's own sw grip in board-note.js.
function stretch(grip, corner = "se") {
  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || note.fullscreen) return;
    e.preventDefault();
    e.stopPropagation(); // not a drag of the note itself
    follow(e, (start, dx, dy) => {
      const height = Math.max(MIN_HEIGHT, start.height + dy);
      if (corner === "sw") {
        const width = Math.max(MIN_WIDTH, start.width - dx);
        return { ...start, x: start.x + (start.width - width), width, height };
      }
      return { ...start, width: Math.max(MIN_WIDTH, start.width + dx), height };
    });
  });
}

// One gesture, two shapes of it. `next` says what the box becomes for a given
// travel, which is all a move and a resize disagree about. `tuckIfOffEdge` is
// only for a move: a resize that grows past the edge is the note asking to be
// bigger, not asking to leave, and stretch() does not pass it.
function follow(down, next, tap, { tuckIfOffEdge = false } = {}) {
  const start = { ...box };
  let moved = false;
  holding = true;
  settle();

  const onMove = (e) => {
    const dx = e.clientX - down.clientX;
    const dy = e.clientY - down.clientY;
    if (!moved && Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;
    moved = true;
    box = clampBox(next(start, dx, dy), viewport());
    layout();
  };

  const end = (e, keep) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("keydown", onKey, true);
    holding = false;
    if (!moved) {
      if (tap && e) tap(e);
    } else if (keep && tuckIfOffEdge && !fitsFully(box, viewport())) {
      // Dragged past an edge rather than pressing Escape to ask for this
      // directly — the same place either way: a sliver at the nearest edge,
      // not a corner of the card left hanging off the page with no way back.
      tuck(true);
    } else if (keep) {
      // Its place on the page, which is not its place on the board: that one
      // is left exactly where it is.
      note.floatingGeometry = { ...box };
      saveNote(note);
    } else {
      box = start;
      layout();
    }
    settle();
  };

  const onUp = (e) => end(e, true);
  // Escape abandons it, as it does on the board.
  const onKey = (e) => {
    if (e.key !== "Escape" || !moved) return;
    e.preventDefault();
    e.stopPropagation();
    end(null, false);
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("keydown", onKey, true);
}

/* --------------------------------------------------------------- keyboard */

// Escape walks the same ladder as on the board — an open picker, fullscreen —
// but its last rung is different. Over a webpage, putting a note away means
// tucking it to the side of the page, out of the way and one click from back;
// taking it off every page is Unfloat, in its menu. Held down, Escape tucks
// away every floating note at once — and held again once they all already
// are, it is the way back out instead, same as tapping every tab in turn.
//
// Decided when the key comes up rather than when it goes down, since until
// then a press and the start of a hold are the same thing.
let held = null;

function armEscape() {
  if (held) return;
  held = { fired: false };
  held.timer = setTimeout(() => {
    held.fired = true;
    tuckAll();
  }, HOLD_MS);
}

// Not asking whether something already handled the key: the editor marks its
// own Escape as handled, and the board's ladder does not ask either. What must
// not see it — an open menu, a drag — stops it before it gets here.
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !el || e.repeat) return;
  // A picker or fullscreen closes at once. The note's own rung arms through
  // host.dismiss; a frame with no note open arms here.
  if (!dismissTopmost()) armEscape();
  settle();
});

window.addEventListener("keyup", (e) => {
  if (e.key !== "Escape" || !held) return;
  clearTimeout(held.timer);
  if (!held.fired) tuck(true);
  held = null;
});

// Focus went elsewhere mid-hold, and the key will come up somewhere else.
window.addEventListener("blur", () => {
  if (!held) return;
  clearTimeout(held.timer);
  held = null;
});

// Every floating note to the side, each given its tab in turn so that no two
// end up on top of each other. Held again with every one of them already
// tucked, it means the opposite: bring them all back out, the same hold
// undoing what the last one did rather than being a one-way door.
async function tuckAll() {
  const records = await floatingRecords();
  if (note.floatingTucked && records.every((n) => n.id === id || n.floatingTucked)) {
    untuckAll(records);
    return;
  }

  const taken = tabsTaken(records);
  const v = viewport();
  if (!note.floatingTucked) {
    clearActiveNote();
    if (el.isConnected) {
      note.floatingTucked = tuckedSpot(box, v, taken);
      taken.push(note.floatingTucked);
      slide();
      saveNote(note);
    }
  }
  records
    .filter((n) => n.id !== id && !n.floatingTucked)
    .forEach((n) => {
      const spot = tuckedSpot(clampBox(n.floatingGeometry || defaultBox(v), v), v, taken);
      taken.push(spot);
      // Taken in by its own frames, on every open page.
      patchNote(n.id, { floatingTucked: spot });
    });
}

function untuckAll(records) {
  delete note.floatingTucked;
  slide();
  saveNote(note);
  records.filter((n) => n.id !== id && n.floatingTucked).forEach((n) => patchNote(n.id, { floatingTucked: undefined }));
}
