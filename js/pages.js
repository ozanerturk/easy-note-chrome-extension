import { PAGES, NOTES, META, put, del, getAll, getOne } from "./db.js";
import { notes } from "./store.js";

import { duePageIds, onReminderTick } from "./reminders.js";

const sidebar = document.getElementById("sidebar");
const dragLayer = document.getElementById("drag-layer");
const treeRoot = document.getElementById("page-tree");

export const pages = new Map(); // id -> page record
export let currentPageId = null;

let onSwitch = () => {};
let dragNoteIds = null;

export function setPageSwitchHandler(fn) {
  onSwitch = fn;
}

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `page-${Date.now()}-${Math.random()}`;
}

// Every page write stamps updatedAt, which is what sync merges on.
function savePage(page) {
  page.updatedAt = Date.now();
  return put(PAGES, page);
}

function childrenOf(parentId) {
  return [...pages.values()]
    .filter((p) => !p.deleted && (p.parentId || null) === parentId)
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

  if (!pages.size) {
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
    if (!r.pageId || !pages.has(r.pageId)) r.pageId = fallback;
  });
  return records;
}

export function notesOnCurrentPage(records) {
  return records.filter((r) => !r.deleted && r.pageId === currentPageId);
}

export async function switchPage(id) {
  if (id === currentPageId || !pages.has(id)) return;
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
  const count = [...notes.values()].filter((n) => doomed.includes(n.note.pageId)).length;
  const label = count ? ` and its ${count} note${count === 1 ? "" : "s"}` : "";
  if (!confirm(`Delete “${page.name}”${label}? This cannot be undone.`)) return;

  // Tombstones, not deletions — the same reasoning as notes: a hard delete
  // cannot propagate and the page would return on the next sync.
  const at = Date.now();
  const all = await getAll(NOTES);
  await Promise.all(
    all
      .filter((n) => !n.deleted && doomed.includes(n.pageId))
      .map((n) => put(NOTES, { ...n, deleted: true, deletedAt: at, updatedAt: at }))
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

function onNoteDragMove(e) {
  if (!dragNoteIds) return;
  const under = document.elementFromPoint(e.clientX, e.clientY);
  const row = under?.closest("[data-page-id]");
  // The page they are already on cannot receive them, so it must not look
  // like it can.
  markNoteDropRow(row && row.dataset.pageId !== currentPageId ? row : null);
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
    dragLayer.classList.remove("is-over-sidebar");
  }
}

export function draggingNotes() {
  return !!dragNoteIds;
}

// Called on pointerup while notes are being dragged. Returns true if the
// pointer was over a page row, meaning the notes changed page.
export async function dropNotesAt(clientX, clientY, moveNote) {
  if (!dragNoteIds) return false;
  const ids = dragNoteIds;
  setDraggedNotes(null);

  const row = document
    .elementFromPoint(clientX, clientY)
    ?.closest("[data-page-id]");
  if (!row) return false;

  const pageId = row.dataset.pageId;
  if (pageId === currentPageId) return false;

  for (const id of ids) {
    const entry = notes.get(id);
    if (!entry) continue;
    entry.note.pageId = pageId;
    entry.note.updatedAt = Date.now();
    await put(NOTES, entry.note);
    moveNote(entry);
  }
  return true;
}

/* -------------------------------------------------------------- reminders */

// A note that has come due on a page you are not looking at has no way to say
// so. Its page says it instead.
export function markDuePages() {
  const due = duePageIds();
  treeRoot.querySelectorAll("[data-page-id]").forEach((row) => {
    const waiting = due.has(row.dataset.pageId);
    row.classList.toggle("has-due", waiting);
    if (!waiting) row.classList.remove("has-hopped");
  });
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

  const add = document.createElement("button");
  add.className = "page-action";
  add.textContent = "+";
  add.title = "New sub-page";
  add.addEventListener("click", (e) => {
    e.stopPropagation();
    createPage(page.id);
  });

  const remove = document.createElement("button");
  remove.className = "page-action";
  remove.textContent = "×";
  remove.title = "Delete page";
  remove.addEventListener("click", (e) => {
    e.stopPropagation();
    deletePage(page);
  });

  row.append(twisty, name, add, remove);
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
    switchPage(page.id);
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
