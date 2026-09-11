// Picking out lists along with notes: a marquee across a list picks the list,
// not the cards inside it, and moving what is picked out moves the list whole.
// Picking the cards used to tear them out of the list on the next drag.

import { MOD } from "./harness.mjs";

export const title = "grouping";

export default async function run(page, s) {
  const { check } = s;

  const pageId = (await page.stored("pages"))[0].id;
  const now = Date.now();
  await page.seed("lists", [
    { id: "L", pageId, name: "Groceries", x: 120, y: 120, width: 240, createdAt: now, updatedAt: now },
  ]);
  const note = (id, extra) => ({
    id, pageId, html: `<p>${id}</p>`, width: 200, height: 90, z: 1,
    createdAt: now, editedAt: now, updatedAt: now, ...extra,
  });
  await page.seed("notes", [
    note("milk", { x: 0, y: 0, listId: "L", listOrder: 1 }),
    note("eggs", { x: 0, y: 0, listId: "L", listOrder: 2 }),
    note("loose", { x: 480, y: 140 }),
  ]);
  // Start at the corner at 100%, so the board is where the numbers say.
  await page.evaluate(`document.getElementById('zoom-level').click()`);
  await page.key("Escape", "Escape");
  await page.settle(250);

  const boxOf = (sel) => page.evaluate(`(() => {
    const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  })()`);
  const state = () => page.evaluate(`(() => ({
    list: document.querySelector('.list[data-list-id="L"]').classList.contains('is-selected'),
    loose: document.querySelector('.note[data-id="loose"]').classList.contains('is-selected'),
    cardsPicked: document.querySelectorAll('.list-body > .note.is-selected').length,
    cardsInList: document.querySelectorAll('.list[data-list-id="L"] .list-body > .note').length,
  }))()`);
  const records = async () => {
    const notes = Object.fromEntries((await page.stored()).map((n) => [n.id, n]));
    const list = (await page.stored("lists")).find((l) => l.id === "L");
    return { notes, list };
  };

  /* --------------------------------------------------------------- marquee */

  const list = await boxOf('.list[data-list-id="L"]');
  const loose = await boxOf('.note[data-id="loose"]');
  // From bare board above-left of the list to past the loose note.
  const from = { x: list.x - 30, y: list.y - 30 };
  await page.drag(from.x, from.y, loose.x + loose.w + 30 - from.x, list.y + list.h + 30 - from.y);
  await page.settle(200);
  let st = await state();
  check("a marquee across a list picks the list", st.list && st.loose, JSON.stringify(st));
  check("and not the cards inside it", st.cardsPicked === 0, JSON.stringify(st));

  /* ------------------------------------------------ moving what is picked */

  let before = await records();
  await page.drag(loose.x + loose.w / 2, loose.y + loose.h / 2, 150, 90);
  await page.settle(300);
  let after = await records();
  st = await state();
  check("dragging a picked note brings the list along",
    after.list.x - before.list.x === 150 && after.list.y - before.list.y === 90,
    `${before.list.x},${before.list.y} → ${after.list.x},${after.list.y}`);
  check("by the same amount as the note",
    after.notes.loose.x - before.notes.loose.x === 150 && after.notes.loose.y - before.notes.loose.y === 90);
  check("and its cards stay in it", st.cardsInList === 2 && after.notes.milk.listId === "L" && after.notes.eggs.listId === "L",
    JSON.stringify(st));

  await page.key("z", "KeyZ", MOD.meta);
  await page.settle(300);
  after = await records();
  check("one undo puts the lot back",
    after.list.x === before.list.x && after.list.y === before.list.y &&
      after.notes.loose.x === before.notes.loose.x && after.notes.loose.y === before.notes.loose.y,
    `list ${after.list.x},${after.list.y} · loose ${after.notes.loose.x},${after.notes.loose.y}`);

  // The list's own name is a handle too, and carries the rest.
  before = after;
  const head = await boxOf('.list[data-list-id="L"] .list-head');
  await page.drag(head.x + 60, head.y + head.h / 2, 100, 60);
  await page.settle(300);
  after = await records();
  st = await state();
  check("dragging the list by its name brings the picked notes along",
    after.list.x - before.list.x === 100 && after.notes.loose.x - before.notes.loose.x === 100 &&
      after.notes.loose.y - before.notes.loose.y === 60,
    `list ${after.list.x},${after.list.y} · loose ${after.notes.loose.x},${after.notes.loose.y}`);
  check("with its cards still in it", st.cardsInList === 2, JSON.stringify(st));

  /* ------------------------------------------------------ one list alone */

  await page.click(1000, 450);
  await page.settle(200);
  st = await state();
  check("clicking the bare board lets go of everything", !st.list && !st.loose, JSON.stringify(st));

  before = after;
  const head2 = await boxOf('.list[data-list-id="L"] .list-head');
  await page.drag(head2.x + 60, head2.y + head2.h / 2, 40, 30);
  await page.settle(300);
  after = await records();
  check("a list dragged on its own moves alone",
    after.list.x - before.list.x === 40 && after.notes.loose.x === before.notes.loose.x,
    `list ${after.list.x} · loose ${after.notes.loose.x}`);
}
