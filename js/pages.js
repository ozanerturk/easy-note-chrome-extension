import { PAGES, NOTES, META, put, del, getAll, getOne } from "./db.js";
import { notes } from "./store.js";

const sidebar = document.getElementById("sidebar");
const treeRoot = document.getElementById("page-tree");

export const pages = new Map(); // id -> page record
export let currentPageId = null;

let onSwitch = () => {};
let dragNoteIds = null;

export function setPageSwitchHandler(fn) {
  onSwitch = fn;
}

function newId() {
  return `page-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function childrenOf(parentId) {
  return [...pages.values()]
    .filter((p) => (p.parentId || null) === parentId)
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
    await put(PAGES, root);
  }

  const saved = await getOne(META, "currentPage");
  currentPageId =
    saved && pages.has(saved.pageId) ? saved.pageId : childrenOf(null)[0].id;
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
  return records.filter((r) => r.pageId === currentPageId);
}

export async function switchPage(id) {
  if (id === currentPageId || !pages.has(id)) return;
  currentPageId = id;
  await put(META, { id: "currentPage", pageId: id });
  // Only move the highlight. Rebuilding the tree here would replace the row
  // mid-gesture and destroy an in-progress rename, since the first click of a
  // rename double-click also switches page.
  markCurrent();
  await onSwitch(id);
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
  await put(PAGES, page);
  if (parentId) {
    const parent = pages.get(parentId);
    parent.collapsed = false;
    await put(PAGES, parent);
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

  const all = await getAll(NOTES);
  await Promise.all(
    all.filter((n) => doomed.includes(n.pageId)).map((n) => del(NOTES, n.id))
  );
  await Promise.all(doomed.map((id) => del(PAGES, id)));
  doomed.forEach((id) => pages.delete(id));

  if (doomed.includes(currentPageId)) {
    currentPageId = childrenOf(null)[0].id;
    await put(META, { id: "currentPage", pageId: currentPageId });
    onSwitch(currentPageId);
  }
  renderTree();
}

function beginRename(nameEl, page) {
  nameEl.contentEditable = "true";
  nameEl.classList.add("is-editing");
  nameEl.focus();
  document.execCommand("selectAll", false, null);

  const finish = async (commit) => {
    nameEl.removeEventListener("keydown", onKey);
    nameEl.contentEditable = "false";
    nameEl.classList.remove("is-editing");
    const value = nameEl.textContent.trim();
    if (commit && value) {
      page.name = value;
      await put(PAGES, page);
    }
    nameEl.textContent = page.name;
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

/* ------------------------------------------------- notes dropped on a page */

export function setDraggedNotes(ids) {
  dragNoteIds = ids && ids.length ? ids : null;
  sidebar.classList.toggle("is-drop-target", !!dragNoteIds);
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
    await put(NOTES, entry.note);
    moveNote(entry);
  }
  return true;
}

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
    await put(PAGES, page);
    renderTree();
  });

  const name = document.createElement("span");
  name.className = "page-name";
  name.textContent = page.name;

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
  row.addEventListener("click", () => switchPage(page.id));
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
}

export function initPages() {
  document.getElementById("add-page").addEventListener("click", () => createPage(null));
  document.getElementById("toggle-sidebar").addEventListener("click", () => {
    const hidden = document.body.classList.toggle("sidebar-hidden");
    put(META, { id: "sidebar", hidden }).catch(() => {});
  });
}
