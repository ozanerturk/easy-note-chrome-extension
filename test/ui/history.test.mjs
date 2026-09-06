// ⌘Z on the board: the moves, the resizes, the edits and the deletes.
//
// The one thing a test cannot fake is which of the two histories answers a
// keypress — Tiptap's, inside the note, or the board's outside it — so every
// check here goes through a real key event and the real focus.

import { MOD } from "./harness.mjs";

export const title = "history";

const undo = async (page) => {
  await page.key("z", "KeyZ", MOD.meta);
  await page.settle(260);
};
const redo = async (page) => {
  await page.key("z", "KeyZ", MOD.meta | MOD.shift);
  await page.settle(260);
};

/** Where the note is on screen — what a gesture has to aim at. */
const rect = (page) =>
  page.evaluate(`(() => {
    const n = document.querySelector('.note');
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  })()`);

/** Where it is on the board, and what it says — what a step has to restore. */
const state = (page) =>
  page.evaluate(`(() => {
    const n = document.querySelector('.note');
    if (!n) return null;
    return { x: Math.round(parseFloat(n.style.left)), y: Math.round(parseFloat(n.style.top)),
             w: Math.round(parseFloat(n.style.width)), h: Math.round(parseFloat(n.style.height)),
             text: n.querySelector('.note-body').textContent.trim() };
  })()`);

const count = (page) => page.evaluate(`document.querySelectorAll('.note').length`);
const stored = async (page) => (await page.stored()).filter((n) => !n.deleted);

export default async function run(page, s) {
  const { check } = s;

  await page.click(600, 400, 2);
  await page.type("draggable");
  await page.click(950, 250); // leave it, so the board hears the keys
  await page.settle();

  /* ------------------------------------------------------------- moving */

  const home = await state(page);
  let on = await rect(page);
  await page.drag(on.x + on.w / 2, on.y + on.h / 2, 140, 90);
  await page.settle();
  const moved = await state(page);
  check("a drag moves the note",
    Math.abs(moved.x - home.x - 140) < 4 && Math.abs(moved.y - home.y - 90) < 4,
    `${moved.x - home.x},${moved.y - home.y}`);

  await undo(page);
  let now = await state(page);
  check("⌘Z puts it back", now.x === home.x && now.y === home.y, `${now.x},${now.y}`);

  await redo(page);
  now = await state(page);
  check("⌘⇧Z moves it again", now.x === moved.x && now.y === moved.y, `${now.x},${now.y}`);
  check("and the redone position is what is stored",
    Math.round((await stored(page))[0].x) === moved.x, `${(await stored(page))[0].x}`);

  await undo(page); // back home, and the resize below starts from a known size

  /* ------------------------------------------------------------ resizing */

  on = await rect(page);
  const small = await state(page);
  await page.drag(on.x + on.w - 5, on.y + on.h - 5, 70, 50);
  await page.settle();
  const big = await state(page);
  check("the grip resizes the note", big.w > small.w + 40 && big.h > small.h + 30,
    `${small.w}x${small.h} -> ${big.w}x${big.h}`);

  await undo(page);
  now = await state(page);
  check("⌘Z restores the size", now.w === small.w && now.h === small.h, `${now.w}x${now.h}`);

  await redo(page);
  now = await state(page);
  check("⌘⇧Z resizes it again", now.w === big.w && now.h === big.h, `${now.w}x${now.h}`);

  /* -------------------------------------------------------------- typing */

  // Inside the note the editor owns ⌘Z, and the board must keep its hands off.
  on = await rect(page);
  await page.click(on.x + 40, on.y + 30);
  await page.settle();
  await page.typeKeys("more");
  await page.settle();
  await undo(page);
  now = await state(page);
  check("⌘Z inside a note undoes the typing, not the resize",
    now.w === big.w && now.text === "draggable", `${now.w} "${now.text}"`);

  // One visit to a note is one step on the board.
  await page.click(950, 250);
  await page.settle();
  on = await rect(page);
  await page.click(on.x + 40, on.y + 30);
  await page.settle();
  await page.typeKeys("again");
  await page.click(950, 250);
  await page.settle();
  check("the edit lands", (await state(page)).text.includes("again"), (await state(page)).text);

  await undo(page);
  now = await state(page);
  check("⌘Z on the board takes back the whole visit", now.text === "draggable", now.text);
  const html = (await stored(page))[0].html;
  check("and the undone words are what is stored",
    html.includes("draggable") && !html.includes("again"), html);

  await redo(page);
  check("⌘⇧Z types them back", (await state(page)).text.includes("again"), (await state(page)).text);

  /* ------------------------------------------------------------- deleting */

  // Selected by marquee rather than by clicking: a click would put the caret
  // in the note, and Backspace there is typing, not deleting.
  on = await rect(page);
  await page.drag(on.x - 60, on.y - 60, on.w + 120, on.h + 120);
  await page.settle();
  await page.key("Backspace", "Backspace");
  await page.settle();
  check("the selected note is deleted", (await count(page)) === 0);

  await undo(page);
  check("⌘Z brings it back", (await count(page)) === 1);
  check("with its words", ((await state(page)) || {}).text?.includes("again") === true);

  await redo(page);
  check("⌘⇧Z deletes it again", (await count(page)) === 0);
  await undo(page);

  /* ------------------------------------------------------------- creating */

  await page.click(300, 560, 2);
  await page.type("brand new");
  await page.click(950, 250);
  await page.settle();
  check("a second note is made", (await count(page)) === 2);

  await undo(page);
  check("⌘Z unmakes a note, words and all", (await count(page)) === 1);

  // A note made and abandoned empty leaves no mark on the board, so it must
  // leave none in the history either — ⌘Z belongs to the edit before it.
  await page.click(300, 560, 2);
  await page.click(950, 250);
  await page.settle();
  check("an empty note is discarded on the way out", (await count(page)) === 1);
  await undo(page);
  check("⌘Z reaches past it to the edit underneath",
    (await state(page)).text === "draggable", (await state(page)).text);

  /* -------------------------------------------------- the end of the stack */

  for (let i = 0; i < 6; i++) await undo(page);
  check("undoing everything empties the board", (await count(page)) === 0);
  const toast = await page.evaluate(`document.getElementById('toast').textContent`);
  check("and running out says so rather than throwing", toast === "Nothing to undo", toast);

  /* ----------------------------------------------------------- arranging */

  await page.click(450, 300, 2);
  await page.type("one");
  await page.click(820, 540, 2);
  await page.type("two");
  await page.click(1050, 140);
  await page.settle();

  await page.drag(380, 220, 620, 420); // a marquee over both
  await page.settle();
  check("both notes are selected",
    (await page.evaluate(`document.querySelectorAll('.note.is-selected').length`)) === 2);

  const spread = await page.evaluate(`[...document.querySelectorAll('.note')].map((n) => n.style.left)`);
  await page.evaluate(`document.querySelector('#arrange [data-grid]').click()`);
  await page.settle();
  const gridded = await page.evaluate(`[...document.querySelectorAll('.note')].map((n) => n.style.left)`);
  check("the grid button lines them up", String(gridded) !== String(spread), String(gridded));

  await undo(page);
  check("⌘Z undoes an arrange in one go",
    String(await page.evaluate(`[...document.querySelectorAll('.note')].map((n) => n.style.left)`)) ===
      String(spread));
  await redo(page);
  check("⌘⇧Z arranges them again",
    String(await page.evaluate(`[...document.querySelectorAll('.note')].map((n) => n.style.left)`)) ===
      String(gridded));

  /* -------------------------------------------------------------- filing */

  await page.evaluate(`document.getElementById('add-page').click()`);
  await page.settle(500);
  const rows = await page.evaluate(`[...document.querySelectorAll('[data-page-id]')].map((r) => ({
    id: r.dataset.pageId, box: r.getBoundingClientRect().toJSON() }))`);
  const [homeRow, target] = rows;
  await page.click(homeRow.box.x + 40, homeRow.box.y + homeRow.box.height / 2);
  await page.settle(500);

  await page.click(600, 300, 2);
  await page.type("filed away");
  await page.click(1050, 140);
  await page.settle();
  const here = await count(page);

  // Onto the other page's row, the way the sidebar is meant to be used.
  const grab = await rect(page);
  const tx = target.box.x + target.box.width / 2;
  const ty = target.box.y + target.box.height / 2;
  const fx = grab.x + grab.w / 2;
  const fy = grab.y + grab.h / 2;
  await page.mouse("mousePressed", fx, fy);
  await page.settle(40);
  for (let i = 1; i <= 10; i++) {
    await page.mouse("mouseMoved", fx + ((tx - fx) * i) / 10, fy + ((ty - fy) * i) / 10);
    await page.settle(30);
  }
  await page.mouse("mouseReleased", tx, ty, { buttons: 0 });
  await page.settle(600);

  const filed = async () => (await page.stored()).filter((n) => !n.deleted && n.pageId === target.id).length;
  check("the note is filed into the other page", (await filed()) === 1 && (await count(page)) === here - 1);

  await undo(page);
  check("⌘Z brings it back to the page it came from", (await filed()) === 0);
  check("and back onto the board in front of you", (await count(page)) === here);

  await redo(page);
  check("⌘⇧Z files it away again", (await filed()) === 1 && (await count(page)) === here - 1);
}
