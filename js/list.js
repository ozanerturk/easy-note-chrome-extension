// Lists — a box on the board that holds notes in an order.
//
// The canvas is freeform on purpose, which is the right default for thinking
// and the wrong one for anything with a sequence to it. A page is the only
// grouping the app had, and a page is a whole other canvas — far too heavy for
// "these five belong together, in this order".
//
// A list is put on the board the way a note is, and holds notes stacked inside
// it. It is not a mode and not a view: lists and loose notes share the same
// canvas, and a note outside one is exactly the note it was before.
//
// Architecturally this follows the Capture tray: a renderer over records that
// sync like any other, which is what buys undo and sync for the price of a
// renderer. What it does *not* copy is the tray's thumbnails — a note in a
// list is the real note element, moved into the list, so editing, colour,
// reminders and the ⋯ menu keep working with no second implementation.

import { LISTS, NOTES, put, getAll } from "./db.js";
import { world, view } from "./view.js";
import { notes } from "./store.js";
import { currentPageId } from "./pages.js";
import { showMenu } from "./menu.js";
import { record } from "./history.js";
import { offerUndo } from "./undo.js";
import { registerLayer } from "./board.js";
import { markUsed } from "./tips.js";
import { newId, saveNote, updateHint } from "./note.js";

const DEFAULT_WIDTH = 240;
const DRAG_THRESHOLD = 3;

// id -> { list, el }, the same shape as the notes map next door.
const lists = new Map();

function saveList(list) {
  list.updatedAt = Date.now();
  put(LISTS, list).catch(() => {});
}

/* ------------------------------------------------------------------ ranks */

// Where a note sits inside its list. Appending takes the last rank plus one;
// dropping between two cards takes the midpoint. That way a move writes the one
// record that moved rather than renumbering the column — every write is a row
// that has to survive a merge, so a drag that touches ten of them is ten
// chances for two devices to disagree.
const GAP_FLOOR = 1e-6;

/** The notes in a list, in the order they are shown. */
export function cardsIn(listId) {
  return [...notes.values()]
    .filter(({ note }) => note.listId === listId)
    .sort((a, b) => (a.note.listOrder ?? 0) - (b.note.listOrder ?? 0));
}

// Midpoints halve the gap each time, and a column dropped into the same place
// often enough would run out of room between two numbers. Spreading the ranks
// back out to whole numbers costs a write per card, which is why it happens
// only when the gap has actually closed.
function respace(listId) {
  cardsIn(listId).forEach(({ note }, i) => {
    note.listOrder = i + 1;
    saveNote(note);
  });
}

function rankAt(listId, index, movingId) {
  const ranks = cardsIn(listId)
    .filter(({ note }) => note.id !== movingId)
    .map(({ note }) => note.listOrder ?? 0);

  if (!ranks.length) return 1;
  if (index <= 0) return ranks[0] - 1;
  if (index >= ranks.length) return ranks[ranks.length - 1] + 1;

  const before = ranks[index - 1];
  const after = ranks[index];
  if (after - before > GAP_FLOOR) return (before + after) / 2;

  respace(listId);
  return rankAt(listId, index, movingId);
}

/* --------------------------------------------------------------- the card */

/** The element notes are rendered into, or null if that list is not on screen. */
export function bodyFor(listId) {
  const entry = lists.get(listId);
  return entry ? entry.el.querySelector(".list-body") : null;
}

/** Is this list on the board in front of us? */
export function listIsOnBoard(listId) {
  return !!listId && lists.has(listId);
}

// Moving a note element into a list. The inline geometry has to go: it is
// absolute world coordinates, and in a column the note is laid out by flow.
// Height goes too — a card is as tall as what it says.
export function mountCard(note, el) {
  const body = bodyFor(note.listId);
  if (!body) return false;

  el.classList.add("is-listed");
  el.style.left = "";
  el.style.top = "";
  el.style.width = "";
  el.style.height = "";
  el.style.transform = "";
  el.style.zIndex = "";

  const after = cardsIn(note.listId).find(
    ({ note: other }) => other.id !== note.id && (other.listOrder ?? 0) > (note.listOrder ?? 0)
  );
  const anchor = after && after.el.parentElement === body ? after.el : null;
  body.insertBefore(el, anchor);
  refreshCount(note.listId);
  return true;
}

// Back onto the canvas, at a world position of its own again.
export function unmountCard(note, el) {
  const from = note.listId;
  el.classList.remove("is-listed");
  el.style.left = `${note.x}px`;
  el.style.top = `${note.y}px`;
  el.style.width = `${note.width}px`;
  el.style.height = `${note.height}px`;
  el.style.zIndex = note.z;
  world.appendChild(el);
  if (from) refreshCount(from);
}

function refreshCount(listId) {
  const entry = lists.get(listId);
  if (!entry) return;
  const count = entry.el.querySelector(".list-count");
  const n = cardsIn(listId).length;
  count.textContent = n;
  entry.el.classList.toggle("is-empty", n === 0);
}

/* ------------------------------------------------------------ the writes */

/**
 * Put a note in a list, at a position in it.
 *
 * The one write every path shares — a drag from the canvas, a drag from
 * another list, a reorder inside this one — the way moveNotesToPage is the one
 * write behind every way of filing a note into a page.
 */
export function fileIntoList(note, el, listId, index) {
  note.listId = listId;
  note.listOrder = rankAt(listId, index, note.id);
  saveNote(note);
  mountCard(note, el);
}

/** Take a note out of whatever list it is in, and put it down on the board. */
export function freeNote(note, el, x, y) {
  const from = note.listId;
  delete note.listId;
  delete note.listOrder;
  if (x !== undefined) note.x = Math.round(x);
  if (y !== undefined) note.y = Math.round(y);
  saveNote(note);
  unmountCard(note, el);
  if (from) refreshCount(from);
}

/**
 * Which list is under the pointer, and where in it.
 *
 * Read while a note is in hand, so it answers with a gap rather than a card:
 * the index the note would take if it were let go now. The note being dragged
 * lives in #drag-layer, which takes no pointer events, so it neither hides the
 * list underneath nor counts as one of the cards to measure against.
 */
export function dropAt(clientX, clientY) {
  const under = document.elementFromPoint(clientX, clientY);
  const body = under && under.closest(".list-body");
  if (!body) return null;

  const listId = body.parentElement.dataset.listId;
  const cards = [...body.querySelectorAll(":scope > .note")];
  let index = cards.length;
  for (let i = 0; i < cards.length; i++) {
    const box = cards[i].getBoundingClientRect();
    if (clientY < box.top + box.height / 2) {
      index = i;
      break;
    }
  }
  return { listId, index };
}

// The list under the cursor lights up while notes are in hand, the same way a
// page row does. Without it a drop into a list is a guess.
let litBody = null;

export function markDropList(listId) {
  const body = listId ? bodyFor(listId) : null;
  if (litBody === body) return;
  if (litBody) litBody.classList.remove("is-drop");
  litBody = body;
  if (litBody) litBody.classList.add("is-drop");
}

/* -------------------------------------------------------------- the gap */

// A card lifted out of a list used to leave immediately, and the stack snapped
// shut behind it — so you were dragging into a list that had already changed
// shape, aiming at a place that was no longer there. The gap holds the space
// open and travels to wherever the card would land.
//
// It is the same height as the card in hand, which is what makes this stable:
// the list is already laid out as it will be if you let go, so the index under
// the pointer does not change just because the placeholder moved into it.
let gap = null;

/**
 * Put the gap where a note dropped now would land, and say where that is.
 *
 * @param clientX, clientY  the pointer
 * @param height  how tall the card in hand is
 * @returns {{listId: string, index: number} | null}
 */
export function updateGap(clientX, clientY, height) {
  const target = dropAt(clientX, clientY);
  if (!target) {
    hideGap();
    return null;
  }
  const body = bodyFor(target.listId);
  if (!body) {
    hideGap();
    return null;
  }
  if (!gap) {
    gap = document.createElement("div");
    gap.className = "list-gap";
  }
  gap.style.height = `${height}px`;
  const cards = [...body.querySelectorAll(":scope > .note")];
  body.insertBefore(gap, cards[target.index] || null);
  return target;
}

export function hideGap() {
  if (gap) gap.remove();
}

/**
 * Where the gap is standing, if it is.
 *
 * A drop reads this rather than the pointer, so that a note lands exactly where
 * the gap said it would — the two could otherwise disagree by a row, which is
 * the sort of thing that makes a drag feel untrustworthy.
 */
export function gapTarget() {
  if (!gap || !gap.parentElement) return null;
  const body = gap.parentElement;
  let index = 0;
  for (const child of body.children) {
    if (child === gap) break;
    if (child.classList.contains("note")) index++;
  }
  return { listId: body.parentElement.dataset.listId, index };
}

/* -------------------------------------------------------------- rendering */

export function renderList(list) {
  const el = document.createElement("div");
  el.className = "list";
  el.style.left = `${list.x}px`;
  el.style.top = `${list.y}px`;
  el.style.width = `${list.width || DEFAULT_WIDTH}px`;
  el.dataset.listId = list.id;

  const head = document.createElement("div");
  head.className = "list-head";

  const name = document.createElement("span");
  name.className = "list-name";
  name.textContent = list.name;

  const count = document.createElement("span");
  count.className = "list-count";
  count.textContent = "0";

  const more = document.createElement("button");
  more.className = "list-btn-more";
  more.textContent = "⋯";
  more.title = "List actions";

  head.append(name, count, more);

  const body = document.createElement("div");
  body.className = "list-body";

  el.append(head, body);
  world.appendChild(el);
  lists.set(list.id, { list, el });

  /* behaviour */

  name.addEventListener("dblclick", (e) => {
    e.stopPropagation(); // the canvas would otherwise make a note behind it
    renameList(list);
  });

  more.addEventListener("pointerdown", (e) => e.stopPropagation());
  more.addEventListener("click", (e) => {
    e.stopPropagation();
    const box = more.getBoundingClientRect();
    openListMenu(list, box.left, box.bottom + 4);
  });

  el.addEventListener("contextmenu", (e) => {
    if (e.target.closest(".note")) return; // the note's own menu says more
    e.preventDefault();
    e.stopPropagation();
    openListMenu(list, e.clientX, e.clientY);
  });

  makeListDraggable(el, list, head);
  refreshCount(list.id);
  return el;
}

function openListMenu(list, clientX, clientY) {
  showMenu(
    [
      { label: "Rename…", run: () => renameList(list) },
      null,
      {
        label: "Delete list",
        run: () => deleteList(list),
        danger: true,
      },
    ],
    clientX,
    clientY
  );
}

/* ---------------------------------------------------------------- rename */

// The same interaction as renaming a page, for the same reason: a second way
// to rename a thing is a second thing to learn.
export function renameList(list) {
  const entry = lists.get(list.id);
  if (!entry) return;
  const nameEl = entry.el.querySelector(".list-name");
  if (nameEl.classList.contains("is-editing")) return;

  const before = list.name;
  nameEl.classList.add("is-editing");
  nameEl.contentEditable = "plaintext-only";
  nameEl.spellcheck = false;

  // Taking the caret on the next frame, not this one. Both ways in here run
  // from a menu, and the menu closes itself before running the item — which
  // removes the button that had focus, and the browser's own move of focus back
  // to the body can land after ours and take the caret straight out again.
  requestAnimationFrame(() => {
    if (!nameEl.isConnected || !nameEl.classList.contains("is-editing")) return;
    nameEl.focus();
    const range = document.createRange();
    range.selectNodeContents(nameEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });

  const finish = (commit) => {
    nameEl.removeEventListener("keydown", onKey);
    nameEl.contentEditable = "false";
    nameEl.classList.remove("is-editing");
    const value = nameEl.textContent.trim();
    if (commit && value && value !== before) {
      list.name = value;
      saveList(list);
      record(renameStep(list, before, value));
    }
    nameEl.textContent = list.name;
  };

  function onKey(e) {
    e.stopPropagation(); // board shortcuts must not fire into a name
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

/* ----------------------------------------------------------------- moving */

// The head is the handle. The body is not: a drag that starts on a card has to
// belong to the card, and one that starts on the empty space below them would
// otherwise be ambiguous.
function makeListDraggable(el, list, head) {
  head.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".list-btn-more")) return;
    if (e.target.classList.contains("is-editing")) return;
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const fromX = list.x;
    const fromY = list.y;
    let moved = false;

    const onMove = (m) => {
      // Screen delta -> world delta, as everywhere else on the canvas.
      const dx = (m.clientX - startX) / view.zoom;
      const dy = (m.clientY - startY) / view.zoom;
      if (!moved && Math.hypot(m.clientX - startX, m.clientY - startY) < DRAG_THRESHOLD) return;
      moved = true;
      list.x = Math.round(fromX + dx);
      list.y = Math.round(fromY + dy);
      el.style.left = `${list.x}px`;
      el.style.top = `${list.y}px`;
    };

    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey, true);
    };

    const onUp = () => {
      stop();
      if (!moved) return;
      saveList(list);
      record(moveStep(list, { x: fromX, y: fromY }, { x: list.x, y: list.y }));
    };

    // Escape abandons the move, as it does for a note.
    const onKey = (keyEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      stop();
      placeList(list, { x: fromX, y: fromY });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("keydown", onKey, true);
  });
}

function placeList(list, at) {
  list.x = at.x;
  list.y = at.y;
  const entry = lists.get(list.id);
  if (entry) {
    entry.el.style.left = `${at.x}px`;
    entry.el.style.top = `${at.y}px`;
  }
  saveList(list);
}

/* --------------------------------------------------------- making, unmaking */

export function createList(worldX, worldY) {
  markUsed("lists");
  const list = {
    id: newId(),
    pageId: currentPageId,
    name: "New list",
    x: Math.round(worldX),
    y: Math.round(worldY),
    width: DEFAULT_WIDTH,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  renderList(list);
  saveList(list);
  updateHint(); // the board is no longer empty, whatever the note count says
  record(createStep(list));
  renameList(list); // it arrives asking to be named
  return list;
}

/**
 * Remove a list. Its notes are put back on the board where it stood.
 *
 * A grouping is never worth losing a note over, so this deletes the list and
 * nothing else — the notes spill out rather than going with it.
 */
export function deleteList(list) {
  const members = spill(list);
  tombstone(list);
  const what = members.length
    ? `List deleted · ${members.length} ${members.length === 1 ? "note" : "notes"} kept`
    : "List deleted";
  offerUndo(what, record(deleteStep(list, members)));
}

// Lay the notes out down the board from where the list was, so they come out
// roughly where they were seen last rather than in a heap on one another.
function spill(list) {
  const members = cardsIn(list.id).map(({ note }, i) => ({
    note,
    listOrder: note.listOrder,
    to: { x: list.x, y: list.y + i * 24 },
  }));
  members.forEach(({ note, to }) => {
    const entry = notes.get(note.id);
    freeNote(note, entry.el, to.x, to.y);
  });
  return members;
}

function tombstone(list) {
  const entry = lists.get(list.id);
  if (entry) entry.el.remove();
  lists.delete(list.id);
  list.deleted = true;
  list.deletedAt = Date.now();
  saveList(list);
  updateHint();
}

function revive(list) {
  delete list.deleted;
  delete list.deletedAt;
  saveList(list);
  if (list.pageId === currentPageId) renderList(list);
  updateHint();
}

/* ---------------------------------------------------------------- history */

function createStep(list) {
  return {
    kind: "list-create",
    listId: list.id,
    label: "the new list",
    undo: () => {
      spill(list);
      tombstone(list);
    },
    redo: () => revive(list),
  };
}

function deleteStep(list, members) {
  return {
    kind: "list-delete",
    listId: list.id,
    label: "the delete",
    undo: () => {
      revive(list);
      // The notes go back in, in the order they were in, which is the half of
      // this a plain "put the list back" would quietly lose.
      members.forEach(({ note, listOrder }) => {
        const entry = notes.get(note.id);
        if (!entry) return;
        note.listId = list.id;
        note.listOrder = listOrder;
        saveNote(note);
        mountCard(note, entry.el);
      });
      refreshCount(list.id);
    },
    redo: () => {
      spill(list);
      tombstone(list);
    },
  };
}

function renameStep(list, before, after) {
  const apply = (name) => {
    list.name = name;
    saveList(list);
    const entry = lists.get(list.id);
    if (entry) entry.el.querySelector(".list-name").textContent = name;
  };
  return {
    kind: "list-rename",
    listId: list.id,
    label: "the rename",
    undo: () => apply(before),
    redo: () => apply(after),
  };
}

function moveStep(list, from, to) {
  return {
    kind: "list-move",
    listId: list.id,
    label: "the move",
    undo: () => placeList(list, from),
    redo: () => placeList(list, to),
  };
}

/* ------------------------------------------------------------------ board */

export function listsOnCurrentPage(records) {
  return records.filter((r) => !r.deleted && r.pageId === currentPageId);
}

/** How many lists are on the board, so the empty-board hint can count them. */
export function listCount() {
  return lists.size;
}

function clearLists() {
  lists.forEach(({ el }) => el.remove());
  lists.clear();
  litBody = null;
}

async function loadLists() {
  listsOnCurrentPage(await getAll(LISTS)).forEach(renderList);
}

// Lists draw before notes, because a note in a list needs its list's body to
// exist to be rendered into.
registerLayer({ name: "lists", order: 10, clear: clearLists, load: loadLists });
