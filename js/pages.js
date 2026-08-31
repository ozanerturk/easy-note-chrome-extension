import { PAGES, NOTES, META, TRAY_ID, put, del, getAll, getOne } from "./db.js";
import { notes } from "./store.js";

import { duePageIds, dueOnPage, onReminderTick } from "./reminders.js";
import { showMenu, closeMenu } from "./menu.js";
import { markUsed } from "./tips.js";

const sidebar = document.getElementById("sidebar");
const dragLayer = document.getElementById("drag-layer");
const treeRoot = document.getElementById("page-tree");

export const pages = new Map(); // id -> page record
export let currentPageId = null;

let onSwitch = () => {};
let onDuePick = () => {};
let onReselect = () => {};
let dragNoteIds = null;

export function setPageSwitchHandler(fn) {
  onSwitch = fn;
}

/** Called with (noteId, pageId) when a page's due badge is clicked. */
export function setDuePickHandler(fn) {
  onDuePick = fn;
}

/**
 * Called when the page already on screen is clicked again.
 *
 * A handler rather than a direct call into view.js: the view imports the
 * current page from here, and importing it back would close the loop.
 */
export function setReselectHandler(fn) {
  onReselect = fn;
}

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `page-${Date.now()}-${Math.random()}`;
}

// Every page write stamps updatedAt, which is what sync merges on.
function savePage(page) {
  page.updatedAt = Date.now();
  return put(PAGES, page);
}

// The Capture tray is deliberately absent from this. Everything that walks
// the tree — the sidebar, the root fallback, orphan adoption, page ordering —
// goes through here, so one exclusion keeps the tray out of all of them.
function childrenOf(parentId) {
  return [...pages.values()]
    .filter((p) => !p.deleted && p.id !== TRAY_ID && (p.parentId || null) === parentId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
}

function descendantIds(id) {
  const out = [id];
  childrenOf(id).forEach((child) => out.push(...descendantIds(child.id)));
  return out;
}

export async function ensureDefaultPage() {
  const records = await getAll(PAGES);
  records.forEach((p) => pages.set(p.id, p));

  if (!childrenOf(null).length) {
    const root = { id: newId(), name: "My notes", parentId: null, order: 0, collapsed: false };
    pages.set(root.id, root);
    await savePage(root);
  }

  const saved = await getOne(META, "currentPage");
  const remembered = saved && pages.get(saved.pageId);
  // A page deleted on another device is a tombstone here, so it must not be
  // restored as the current page.
  currentPageId =
    remembered && !remembered.deleted ? remembered.id : childrenOf(null)[0].id;
}

// Replace the in-memory tree wholesale, used after a sync pulls changes.
export function adoptPages(records) {
  pages.clear();
  records.forEach((p) => pages.set(p.id, p));
  if (!childrenOf(null).length) return false;
  const current = pages.get(currentPageId);
  if (!current || current.deleted) currentPageId = childrenOf(null)[0].id;
  return true;
}

// Notes predating pages belong to the first page.
export function adoptOrphans(records) {
  const fallback = childrenOf(null)[0].id;
  records.forEach((r) => {
    // A capture is never an orphan, even before this tab has heard of the
    // tray: the service worker can mint the tray page after the sidebar was
    // built, and adopting them here would drag captures onto a board.
    if (r.pageId === TRAY_ID) return;
    if (!r.pageId || !pages.has(r.pageId)) r.pageId = fallback;
  });
  return records;
}

export function notesOnCurrentPage(records) {
  return records.filter((r) => !r.deleted && r.pageId === currentPageId);
}

export async function switchPage(id) {
  if (id === currentPageId || !pages.has(id)) return;
  // The tray has no board of its own; it is the strip along the bottom. There
  // is no row to click, but sync and search can both name a page by id.
  if (id === TRAY_ID) return;
  const previous = currentPageId;
  currentPageId = id;
  await put(META, { id: "currentPage", pageId: id });
  // Only move the highlight. Rebuilding the tree here would replace the row
  // mid-gesture and destroy an in-progress rename, since the first click of a
  // rename double-click also switches page.
  markCurrent();
  await onSwitch(id, previous);
}

function markCurrent() {
  treeRoot.querySelectorAll(".page-row").forEach((row) => {
    row.classList.toggle("is-current", row.dataset.pageId === currentPageId);
  });
}

export async function createPage(parentId = null) {
  const siblings = childrenOf(parentId);
  const page = {
    id: newId(),
    name: "Untitled page",
    parentId,
    order: siblings.length,
    collapsed: false,
  };
  pages.set(page.id, page);
  await savePage(page);
  if (parentId) {
    const parent = pages.get(parentId);
    parent.collapsed = false;
    await savePage(parent);
  }
  renderTree();
  await switchPage(page.id);
  const row = treeRoot.querySelector(`[data-page-id="${page.id}"] .page-name`);
  if (row) beginRename(row, page);
}

async function deletePage(page) {
  if (childrenOf(null).length === 1 && !page.parentId) return; // keep one root

  const doomed = descendantIds(page.id);
  const all = await getAll(NOTES);
  // Counted from the database, not from what happens to be rendered: a
  // sub-page's notes are just as gone, and were never on screen to be counted.
  const living = all.filter((n) => !n.deleted && doomed.includes(n.pageId));
  const count = living.length;

  // An empty page is nothing to lose, so deleting one asks nothing. A page
  // with notes in it asks twice — once for what is going, and once for the
  // part that cannot be taken back.
  if (count) {
    const notesLabel = `${count} note${count === 1 ? "" : "s"}`;
    const sub = doomed.length - 1;
    const subLabel = sub ? ` and ${sub} sub-page${sub === 1 ? "" : "s"}` : "";
    if (!confirm(`Delete “${page.name}”${subLabel}?\n\nIt holds ${notesLabel}.`)) return;
    if (!confirm(`Delete ${notesLabel} for good?\n\nThis cannot be undone — the undo bar does not cover it.`)) return;
  }

  // Tombstones, not deletions — the same reasoning as notes: a hard delete
  // cannot propagate and the page would return on the next sync.
  const at = Date.now();
  await Promise.all(
    living.map((n) => put(NOTES, { ...n, deleted: true, deletedAt: at, updatedAt: at }))
  );
  await Promise.all(
    doomed.map((id) => {
      const p = pages.get(id);
      pages.delete(id);
      return p ? put(PAGES, { ...p, deleted: true, deletedAt: at, updatedAt: at }) : null;
    })
  );

  if (doomed.includes(currentPageId)) {
    currentPageId = childrenOf(null)[0].id;
    await put(META, { id: "currentPage", pageId: currentPageId });
    onSwitch(currentPageId);
  }
  renderTree();
}

/* ------------------------------------------------------- the page menu */

// Everything a page can have done to it. Reached by right-clicking the row or
// by its one ⋯ button — two buttons sitting on every row, waiting to be
// clicked, was more furniture than the sidebar could carry.
function openPageMenu(page, clientX, clientY) {
  // Only root pages are protected, and only when they are the last one: the
  // tree has to keep somewhere for notes to live.
  const lastRoot = childrenOf(null).length === 1 && !page.parentId;

  showMenu(
    [
      { label: "Rename", run: () => {
        const row = treeRoot.querySelector(`[data-page-id="${page.id}"] .page-name`);
        if (row) beginRename(row, page);
      } },
      { label: "New sub-page", run: () => createPage(page.id) },
      null,
      { label: "Delete page", run: () => deletePage(page), danger: true, disabled: lastRoot },
    ],
    clientX,
    clientY
  );
}

export function beginRename(nameEl, page) {
  if (nameEl.classList.contains("is-editing")) return;
  // The class carries user-select:text, so it has to land before focus —
  // a contenteditable that cannot be selected cannot take a caret.
  nameEl.classList.add("is-editing");
  nameEl.contentEditable = "plaintext-only";
  nameEl.spellcheck = false;
  nameEl.focus();

  const range = document.createRange();
  range.selectNodeContents(nameEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const finish = async (commit) => {
    nameEl.removeEventListener("keydown", onKey);
    nameEl.contentEditable = "false";
    nameEl.classList.remove("is-editing");
    const value = nameEl.textContent.trim();
    if (commit && value) {
      page.name = value;
      await savePage(page);
    }
    nameEl.textContent = page.name;
    if (nameEl.scrollWidth > nameEl.clientWidth + 1) nameEl.title = page.name;
    else nameEl.removeAttribute("title");
  };

  function onKey(e) {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      nameEl.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(false);
    }
  }

  nameEl.addEventListener("blur", () => finish(true), { once: true });
  nameEl.addEventListener("keydown", onKey);
}

/* ------------------------------------------------------- sidebar width */

const SIDEBAR_DEFAULT = 208;
const SIDEBAR_MIN = 150;
const SIDEBAR_MAX = 460;

function clampWidth(px) {
  return Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, px)));
}

export function applySidebarWidth(px, { persist = true } = {}) {
  const w = clampWidth(px);
  document.documentElement.style.setProperty("--sidebar-w", `${w}px`);
  if (!persist) return w;
  // Mirrored to localStorage so boot.js can set it before the first paint,
  // the same reason the collapsed state is mirrored.
  try {
    localStorage.setItem("easynote:sidebarWidth", String(w));
  } catch (e) {
    /* ignore */
  }
  put(META, { id: "sidebarWidth", width: w }).catch(() => {});
  return w;
}

function initSidebarResize() {
  const grip = document.getElementById("sidebar-resize");
  if (!grip) return;

  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    document.body.classList.add("is-resizing");

    const move = (m) => applySidebarWidth(m.clientX, { persist: false });
    const up = (m) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("is-resizing");
      applySidebarWidth(m.clientX); // one write at the end, not per frame
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });

  grip.addEventListener("dblclick", () => applySidebarWidth(SIDEBAR_DEFAULT));
}

/* ------------------------------------------------------ reordering pages */

let pageDrag = null;
let dragEndedAt = 0;

// A drop lands relative to the row under the pointer: near its top or bottom
// edge reorders, the middle band nests.
function dropModeFor(row, clientY) {
  const r = row.getBoundingClientRect();
  const t = (clientY - r.top) / r.height;
  if (t < 0.3) return "before";
  if (t > 0.7) return "after";
  return "child";
}

function clearDropMarks() {
  treeRoot.querySelectorAll(".page-row").forEach((r) =>
    r.classList.remove("drop-before", "drop-after", "drop-child")
  );
}

function onPageDragMove(e) {
  if (!pageDrag) return;
  if (!pageDrag.moved) {
    if (Math.hypot(e.clientX - pageDrag.startX, e.clientY - pageDrag.startY) < 4) return;
    pageDrag.moved = true;
    pageDrag.row.classList.add("is-dragging");
    sidebar.classList.add("is-reordering");
  }

  clearDropMarks();
  const row = document.elementFromPoint(e.clientX, e.clientY)?.closest(".page-row");
  pageDrag.target = null;
  if (!row || row === pageDrag.row) return;

  const targetId = row.dataset.pageId;
  // Never drop a page inside its own subtree — that would orphan the branch.
  if (descendantIds(pageDrag.id).includes(targetId)) return;

  const mode = dropModeFor(row, e.clientY);
  row.classList.add(`drop-${mode}`);
  pageDrag.target = { id: targetId, mode };
}

function onPageDragEnd() {
  if (!pageDrag) return;
  const { moved, target, row } = pageDrag;
  row.classList.remove("is-dragging");
  sidebar.classList.remove("is-reordering");
  clearDropMarks();
  window.removeEventListener("pointermove", onPageDragMove);
  window.removeEventListener("pointerup", onPageDragEnd);
  const id = pageDrag.id;
  pageDrag = null;

  if (!moved) return;
  dragEndedAt = Date.now(); // stops the row's click from switching page
  if (target) movePage(id, target.id, target.mode);
}

export async function movePage(dragId, targetId, mode) {
  const drag = pages.get(dragId);
  const target = pages.get(targetId);
  if (!drag || !target || dragId === targetId) return;
  if (descendantIds(dragId).includes(targetId)) return;

  const newParent = mode === "child" ? targetId : target.parentId || null;

  // The tree must keep at least one top-level page, or there is nothing left
  // to render.
  const roots = childrenOf(null);
  if (newParent && roots.length === 1 && roots[0].id === dragId) return;

  const siblings = childrenOf(newParent).filter((p) => p.id !== dragId);
  let index = siblings.length;
  if (mode !== "child") {
    const at = siblings.findIndex((p) => p.id === targetId);
    if (at >= 0) index = mode === "after" ? at + 1 : at;
  }
  siblings.splice(index, 0, drag);

  drag.parentId = newParent;
  if (mode === "child" && target.collapsed) {
    target.collapsed = false;
    await savePage(target);
  }
  for (let i = 0; i < siblings.length; i++) {
    if (siblings[i].order !== i || siblings[i].id === dragId) {
      siblings[i].order = i;
      await savePage(siblings[i]);
    }
  }
  renderTree();
}

/* ------------------------------------------------- notes dropped on a page */

// Dropping notes on a page is invisible unless the sidebar says so, and the
// row under the cursor filling in says it without decorating the panel.
let noteDropRow = null;

function markNoteDropRow(row) {
  if (noteDropRow === row) return;
  if (noteDropRow) noteDropRow.classList.remove("is-note-drop");
  noteDropRow = row;
  if (noteDropRow) noteDropRow.classList.add("is-note-drop");
}

/* ------------------------------------------------------- spring-loading */

// Hovering a page while carrying notes opens it, so they can be put down
// somewhere chosen rather than dropped into a page sight unseen and hunted
// for later.
//
// The delay is short enough not to read as waiting, but it cannot be zero.
// Reaching a row means travelling across the rows above or below it, and a
// switch is not a free redraw: it writes the view of the page being left,
// rebuilds the whole board, and drops any undo still on offer. Opening every
// page merely passed over would flash through three boards on the way to the
// one that was wanted.
const SPRING_MS = 250;

let springTimer = null;
let springPageId = null;

function cancelSpring() {
  clearTimeout(springTimer);
  springTimer = null;
  if (springPageId) {
    treeRoot
      .querySelector(`[data-page-id="${springPageId}"]`)
      ?.classList.remove("is-springing");
  }
  springPageId = null;
}

function armSpring(pageId) {
  if (pageId === springPageId) return; // already counting down on this row
  cancelSpring();
  // Nothing to open: no row under the cursor, or it is the board already up.
  if (!pageId || pageId === currentPageId) return;

  springPageId = pageId;
  treeRoot.querySelector(`[data-page-id="${pageId}"]`)?.classList.add("is-springing");
  springTimer = setTimeout(() => {
    const id = springPageId;
    cancelSpring();
    // The notes stay in hand across the switch — switchPage rebuilds the
    // board under them, it does not end the gesture.
    if (id) switchPage(id);
  }, SPRING_MS);
}

function onNoteDragMove(e) {
  if (!dragNoteIds) return;
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const row = under?.closest("[data-page-id]");
  // Every page is a target, the notes' own included: having sprung a page open
  // there has to be a way back, and a row that refuses to light up reads as
  // broken rather than as "nothing to do here".
  markNoteDropRow(row || null);
  armSpring(row ? row.dataset.pageId : null);
  // A note is wider than the sidebar, so carrying one over it hides the very
  // list being aimed at — including the row lighting up underneath. Fade the
  // note out of the way while it is over the panel.
  dragLayer.classList.toggle("is-over-sidebar", !!under?.closest("#sidebar"));
}

export function setDraggedNotes(ids) {
  dragNoteIds = ids && ids.length ? ids : null;
  sidebar.classList.toggle("is-drop-target", !!dragNoteIds);
  if (dragNoteIds) {
    window.addEventListener("pointermove", onNoteDragMove);
  } else {
    window.removeEventListener("pointermove", onNoteDragMove);
    markNoteDropRow(null);
    cancelSpring();
    dragLayer.classList.remove("is-over-sidebar");
  }
}

// Which notes are in hand. A page switch mid-drag tears the board down and
// rebuilds it; these have to survive that, or the note being carried is
// destroyed halfway through the gesture.
export function notesInHand() {
  return dragNoteIds ? new Set(dragNoteIds) : null;
}

/**
 * Which page's row is under the pointer, if any, and if it can take a drop.
 *
 * Separate from the move itself because the two drop paths ask at different
 * moments: the board reads the target before it lets go of the drag, the
 * Capture tray reads it while carrying a thumbnail rather than a real note.
 */
export function dropTargetAt(clientX, clientY) {
  const row = document.elementFromPoint(clientX, clientY)?.closest("[data-page-id]");
  return row ? row.dataset.pageId : null;
}

/** Move note records to a page. The one write both drop paths share. */
export async function moveNotesToPage(records, pageId) {
  if (records.length) markUsed("filing");
  const at = Date.now();
  for (const note of records) {
    note.pageId = pageId;
    note.updatedAt = at;
    await put(NOTES, note);
  }
}

/* -------------------------------------------------------------- reminders */

// Where each page got to in its own queue of due notes, so clicking a badge
// twice takes you to two different notes rather than the same one.
const dueCursor = new Map();

// A note that has come due on a page you are not looking at has no way to say
// so. Its page says it instead — a count you can click through, rather than
// only a nudge that something somewhere needs attention.
export function markDuePages() {
  const due = duePageIds();
  treeRoot.querySelectorAll("[data-page-id]").forEach((row) => {
    const pageId = row.dataset.pageId;
    const waiting = due.has(pageId);
    row.classList.toggle("has-due", waiting);
    if (!waiting) {
      row.classList.remove("has-hopped");
      dueCursor.delete(pageId);
    }

    const badge = row.querySelector(".page-badge");
    if (!badge) return;
    const count = dueOnPage(pageId).length;
    badge.textContent = String(count);
    badge.title = count === 1 ? "1 note due — click to go to it" : `${count} notes due — click to step through them`;
  });
}

// Step to the next due note on a page, wrapping round at the end.
function visitNextDue(pageId) {
  const ids = dueOnPage(pageId);
  if (!ids.length) return;
  const at = (dueCursor.get(pageId) ?? -1) + 1;
  dueCursor.set(pageId, at % ids.length);
  onDuePick(ids[at % ids.length], pageId);
}

// One hop per spell of being due, as with the notes themselves.
treeRoot.addEventListener("animationend", (e) => {
  if (e.animationName !== "name-wiggle") return;
  e.target.closest(".page-row")?.classList.add("has-hopped");
});

onReminderTick(markDuePages);

/* ------------------------------------------------------------------- tree */

function rowFor(page, depth) {
  const row = document.createElement("div");
  row.className = "page-row";
  row.dataset.pageId = page.id;
  row.style.paddingLeft = `${8 + depth * 14}px`;
  if (page.id === currentPageId) row.classList.add("is-current");

  const kids = childrenOf(page.id);

  const twisty = document.createElement("button");
  twisty.className = "page-twisty";
  twisty.textContent = kids.length ? (page.collapsed ? "▸" : "▾") : "";
  twisty.disabled = !kids.length;
  twisty.addEventListener("click", async (e) => {
    e.stopPropagation();
    page.collapsed = !page.collapsed;
    await savePage(page);
    renderTree();
  });

  const name = document.createElement("span");
  name.className = "page-name";
  name.textContent = page.name;
  // Long page names are ellipsised; a title reveals the full one, but only
  // when it is genuinely truncated so hovering short names shows nothing.
  requestAnimationFrame(() => {
    if (name.scrollWidth > name.clientWidth + 1) name.title = page.name;
    else name.removeAttribute("title");
  });

  // Sits in its own column between the name and the actions, so badges line
  // up down the tree however long or short the names are.
  const badge = document.createElement("button");
  badge.className = "page-badge";
  badge.addEventListener("click", (e) => {
    e.stopPropagation(); // the row's own click would only switch page
    visitNextDue(page.id);
  });

  const more = document.createElement("button");
  more.className = "page-action";
  more.textContent = "⋯";
  more.title = "Page actions";
  more.addEventListener("pointerdown", (e) => e.stopPropagation()); // not a drag
  more.addEventListener("click", (e) => {
    e.stopPropagation();
    const r = more.getBoundingClientRect();
    openPageMenu(page, r.left, r.bottom + 4);
  });

  row.append(twisty, name, badge, more);

  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openPageMenu(page, e.clientX, e.clientY);
  });
  row.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".page-action, .page-twisty")) return;
    if (row.querySelector(".page-name.is-editing")) return;
    pageDrag = { id: page.id, row, startX: e.clientX, startY: e.clientY, moved: false, target: null };
    window.addEventListener("pointermove", onPageDragMove);
    window.addEventListener("pointerup", onPageDragEnd);
  });

  row.addEventListener("click", () => {
    // A reorder drag ends in a click on this row; it must not also switch page.
    if (Date.now() - dragEndedAt < 250) return;
    // Clicking the page you are already on has always done nothing. It now
    // takes you to that page's home view — the same click, the same place,
    // whether or not you had wandered off across the board.
    if (page.id === currentPageId) onReselect(page.id);
    else switchPage(page.id);
  });
  row.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    beginRename(name, page);
  });

  return row;
}

function renderBranch(parentId, depth, container) {
  childrenOf(parentId).forEach((page) => {
    container.appendChild(rowFor(page, depth));
    if (!page.collapsed) renderBranch(page.id, depth + 1, container);
  });
}

export function renderTree() {
  treeRoot.textContent = "";
  closeMenu(); // it points at rows that are about to be replaced
  renderBranch(null, 0, treeRoot);
  markDuePages(); // the rows were just rebuilt and know nothing yet
}

export function initPages() {
  initSidebarResize();
  document.getElementById("add-page").addEventListener("click", () => createPage(null));
  document.getElementById("toggle-sidebar").addEventListener("click", () => {
    const hidden = document.documentElement.classList.toggle("sidebar-hidden");
    // Mirrored to localStorage so boot.js can apply it before first paint.
    try {
      localStorage.setItem("easynote:sidebar", hidden ? "hidden" : "shown");
    } catch (e) {
      /* ignore */
    }
    put(META, { id: "sidebar", hidden }).catch(() => {});
  });
}
