// Lists — the box on the board that holds notes in an order.
//
// The drags here are real pointer input, which is the whole point: filing a
// note into a list is a gesture, and a synthetic click would exercise none of
// the drop-target reading it depends on. Every check asks the DOM *and* the
// record, because the two going out of step is exactly the failure this
// feature can have — a card that looks filed and is not, or the other way up.
//
// The canvas is roughly 992x600 with the sidebar open, so everything here is
// aimed inside that: lists down the left, notes made over on the right.

export const title = "lists";

const AWAY = { x: 1150, y: 560 }; // bare canvas, clear of everything below

const count = (selector) => `document.querySelectorAll(${JSON.stringify(selector)}).length`;

// What the cards in a list say, in the order they are stacked. Read from the
// body: the header carries a lock mark and a ⋯ that are not the note's words.
const CARDS = `[...document.querySelectorAll('.list-body > .note')]
  .map((n) => n.querySelector('.note-body').textContent.trim().split(' ')[0]).join(',')`;

const rightClick = async (page, x, y) => {
  await page.cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x, y, button: "right", buttons: 2, clickCount: 1,
  });
  await page.settle(60);
  await page.cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x, y, button: "right", buttons: 0, clickCount: 1,
  });
  await page.settle(300);
};

const pick = async (page, label) => {
  await page.evaluate(
    `[...document.querySelectorAll('.ctx-item')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`
  );
  await page.settle(300);
};

// A list is made from the canvas menu, and arrives asking to be named.
const makeList = async (page, x, y, name) => {
  await rightClick(page, x, y);
  await pick(page, "New list");
  // The name opens for editing on arrival. type() is execCommand('insertText'),
  // which goes to whatever has focus — so wait for focus itself, not for the
  // element to merely exist, or the letters land nowhere.
  await page.waitFor(`document.activeElement && document.activeElement.classList.contains('list-name')`);
  await page.type(name);
  await page.key("Enter", "Enter");
  await page.settle(350);
};

const makeNote = async (page, x, y, text) => {
  await page.click(x, y, 2);
  // Wait for the caret, not for a stopwatch. Typing into a note whose editor
  // has not taken focus yet leaves the note empty, and an empty note left
  // behind is discarded — so the note under test would simply not be there.
  await page.waitFor(`document.activeElement && document.activeElement.isContentEditable`);
  await page.type(text);
  await page.waitFor(
    `document.querySelector('.note.is-active .note-body').textContent.includes(${JSON.stringify(text.split(" ")[0])})`
  );
  await page.click(AWAY.x, AWAY.y); // leaving it is what saves it
  await page.settle(400);
};

const boxOf = (page, selector) =>
  page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
      top: Math.round(r.top), bottom: Math.round(r.bottom) };
  })()`);

// A card by index, gripped near its top where there is always body to grab.
const cardGrip = (page, listIndex, cardIndex) =>
  page.evaluate(`(() => {
    const list = document.querySelectorAll('.list')[${listIndex}];
    const card = list.querySelectorAll('.list-body > .note')[${cardIndex}];
    if (!card) return null;
    const r = card.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 8), top: Math.round(r.top) };
  })()`);

const listBody = (page, index) =>
  page.evaluate(`(() => {
    const list = document.querySelectorAll('.list')[${index}];
    const r = list.querySelector('.list-body').getBoundingClientRect();
    return { id: list.dataset.listId, x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2), bottom: Math.round(r.bottom) };
  })()`);

// By name, not by position. After a reload the lists come back in whatever
// order the database hands them over, so "the first .list" is not stable — and
// a check that deleted the empty list instead of the full one still passed
// most of the time, which is the worst kind of test.
const named = (name) =>
  `[...document.querySelectorAll('.list')].find((l) => l.querySelector('.list-name').textContent === ${JSON.stringify(name)})`;

const liveNotes = async (page) => (await page.stored("notes")).filter((n) => !n.deleted);
const words = (note) => note.html.replace(/<[^>]*>/g, "");

export default async function run(page, s) {
  const { check } = s;

  /* ------------------------------------------------------------ making one */

  await makeList(page, 280, 110, "To do");
  check("a list can be made from the canvas menu", (await page.evaluate(count(".list"))) === 1);
  check("it takes the name it was given",
    (await page.evaluate(`document.querySelector('.list-name').textContent`)) === "To do");

  let lists = await page.stored("lists");
  check("and it is saved", lists.length === 1 && lists[0].name === "To do",
    JSON.stringify(lists.map((l) => l.name)));
  check("on the page it was made on", !!lists[0].pageId);
  check("an empty list says what it is for",
    (await page.evaluate(`document.querySelector('.list').classList.contains('is-empty')`)) === true);
  check("and a board with a list on it is not an empty board",
    (await page.evaluate(`getComputedStyle(document.getElementById('hint')).display`)) === "none");

  /* ------------------------------------------------- dragging a note into it */

  await makeNote(page, 850, 300, "first card");
  let note = await boxOf(page, "#world > .note");
  let body = await listBody(page, 0);
  await page.drag(note.x, note.top + 8, body.x - note.x, body.y - note.top - 8);
  await page.settle(500);

  check("dragging a note into a list puts it in the list",
    (await page.evaluate(count(".list-body > .note"))) === 1);
  check("and it is laid out by the column, not by the canvas",
    (await page.evaluate(`document.querySelector('.list-body > .note').classList.contains('is-listed')`)) === true);
  check("so nothing of it is left loose on the board",
    (await page.evaluate(count("#world > .note"))) === 0);

  let records = await liveNotes(page);
  check("the record says which list it is in", !!records[0].listId, String(records[0].listId));
  check("and where in it", typeof records[0].listOrder === "number", String(records[0].listOrder));
  check("the count follows",
    (await page.evaluate(`document.querySelector('.list-count').textContent`)) === "1");

  // On the canvas an unfilled note draws no edge at all, which is right there
  // and wrong in a stack: several of them run together into one block of text.
  check("an unfilled note in a list still reads as a card of its own",
    await page.evaluate(`(() => {
      const s = getComputedStyle(document.querySelector('.list-body > .note'));
      return s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.boxShadow !== 'none';
    })()`));

  // Below the threshold the drag has not begun, and the card is still being
  // laid out by the list. Writing left/top on it there sent it flying across
  // the board by its own world position and back again on the lift. Nothing in
  // a normal page.drag stays under the threshold long enough to catch it, so
  // this one is nudged by hand.
  const still = await cardGrip(page, 0, 0);
  await page.mouse("mousePressed", still.x, still.y);
  await page.mouse("mouseMoved", still.x + 2, still.y + 1);
  await page.settle(90);
  const nudged = await cardGrip(page, 0, 0);
  check("a card sits still while a drag is only just beginning",
    Math.abs(nudged.x - still.x) < 6 && Math.abs(nudged.top - still.top) < 6,
    `${still.x},${still.top} -> ${nudged.x},${nudged.top}`);
  await page.mouse("mouseReleased", still.x + 2, still.y + 1, { buttons: 0 });
  await page.settle(300);

  // The hazard worth a test of its own: a ResizeObserver writes a note's width
  // and height back to its record on any layout change, so a card taking the
  // column's width would overwrite the size the note has on the board — and
  // sync the overwrite. Filing a note must not touch its stored geometry.
  check("filing a note leaves its board size alone",
    records[0].width === 200 && records[0].height === 150,
    `${records[0].width}x${records[0].height}`);

  /* ------------------------------------------------------- a second card */

  await makeNote(page, 850, 300, "second card");
  note = await boxOf(page, "#world > .note");
  body = await listBody(page, 0);
  await page.drag(note.x, note.top + 8, body.x - note.x, body.bottom - 6 - note.top - 8);
  await page.settle(500);

  check("a second note joins it, below the first",
    (await page.evaluate(CARDS)) === "first,second", await page.evaluate(CARDS));
  check("the count keeps up",
    (await page.evaluate(`document.querySelector('.list-count').textContent`)) === "2");

  /* --------------------------------------------------------------- reorder */

  // Driven by hand rather than page.drag, so the middle of the gesture can be
  // looked at: the point of the gap is what the list does *during* a drag.
  const lower = await cardGrip(page, 0, 1);
  const upper = await cardGrip(page, 0, 0);
  const listBefore = await boxOf(page, ".list");

  await page.mouse("mousePressed", lower.x, lower.y);
  await page.settle(40);
  const path = [lower.y - 10, lower.y - 25, upper.top + 3];
  for (const y of path) {
    await page.mouse("mouseMoved", lower.x, y);
    await page.settle(40);
  }

  // A card used to be yanked straight out, and the stack snapped shut behind
  // it — so you were aiming into a list that had already changed shape.
  check("a card in hand leaves a gap standing in its place",
    (await page.evaluate(count(".list-gap"))) === 1);
  const listDuring = await boxOf(page, ".list");
  check("so the list keeps the shape it had",
    Math.abs(listDuring.bottom - listBefore.bottom) < 16,
    `${listBefore.bottom} -> ${listDuring.bottom}`);
  check("and the gap is where the card would land, above the other one",
    (await page.evaluate(
      `[...document.querySelector('.list-body').children].findIndex((c) => c.classList.contains('list-gap'))`
    )) === 0);

  await page.mouse("mouseReleased", lower.x, upper.top + 3, { buttons: 0 });
  await page.settle(500);

  check("dragging a card above another reorders the list",
    (await page.evaluate(CARDS)) === "second,first", await page.evaluate(CARDS));
  check("and the gap goes when the card lands", (await page.evaluate(count(".list-gap"))) === 0);

  const ranked = (await liveNotes(page))
    .filter((n) => n.listId)
    .sort((a, b) => a.listOrder - b.listOrder)
    .map(words);
  check("and the stored ranks agree with what is on screen",
    ranked[0].startsWith("second"), ranked.join(" | "));

  /* -------------------------------------------------- between two lists */

  await makeList(page, 580, 110, "Doing");
  check("a second list can be made", (await page.evaluate(count(".list"))) === 2);

  const top = await cardGrip(page, 0, 0);
  const target = await listBody(page, 1);
  await page.drag(top.x, top.y, target.x - top.x, target.y - top.y);
  await page.settle(500);

  const split = await page.evaluate(
    `[...document.querySelectorAll('.list')].map((l) => l.querySelectorAll('.list-body > .note').length).join(',')`
  );
  check("a card can be dragged from one list into another", split === "1,1", split);
  const moved = (await liveNotes(page)).find((n) => words(n).startsWith("second"));
  check("and the record follows it across", moved.listId === target.id, `${moved.listId} vs ${target.id}`);

  /* ------------------------------------------------------- back out again */

  const out = await cardGrip(page, 1, 0);
  const drop = { x: 1000, y: 480 };
  await page.drag(out.x, out.y, drop.x - out.x, drop.y - out.y);
  await page.settle(500);

  const freed = (await liveNotes(page)).find((n) => words(n).startsWith("second"));
  check("dragging a card onto bare canvas takes it out of the list", !freed.listId, String(freed.listId));
  check("and it stands on the board again",
    (await page.evaluate(count("#world > .note"))) === 1);
  const landed = await boxOf(page, "#world > .note");
  check("where it was let go of, not where it last lived on the canvas",
    Math.abs(landed.x - drop.x) < 70 && Math.abs(landed.top - drop.y) < 70,
    `${landed.x},${landed.top} vs ${drop.x},${drop.y}`);
  check("the list it left says so", (await page.evaluate(
    `document.querySelectorAll('.list')[1].querySelector('.list-count').textContent`)) === "0");

  /* -------------------------------------------------------- moving a list */

  const head = await boxOf(page, ".list .list-head");
  const before = await cardGrip(page, 0, 0);
  await page.drag(head.x, head.y, 80, 50);
  await page.settle(400);
  const after = await cardGrip(page, 0, 0);
  check("moving a list carries its cards with it",
    Math.abs(after.x - before.x - 80) < 12 && Math.abs(after.top - before.top - 50) < 12,
    `moved ${after.x - before.x},${after.top - before.top}`);
  lists = await page.stored("lists");
  check("and the move is saved",
    lists.some((l) => l.name === "To do" && l.x !== 280),
    JSON.stringify(lists.map((l) => [l.name, l.x])));

  /* ------------------------------------------------------- across a reload */

  await page.reload();
  check("lists survive a reload", (await page.evaluate(count(".list"))) === 2);
  check("and so does what is in them", (await page.evaluate(count(".list-body > .note"))) === 1);
  check("the card is still a card",
    (await page.evaluate(`document.querySelector('.list-body > .note').classList.contains('is-listed')`)) === true);
  check("and the note left outside is still outside",
    (await page.evaluate(count("#world > .note"))) === 1);

  /* ------------------------------------------------------------- deleting */

  const held = (await liveNotes(page)).length;
  check("the list with the card in it is the one being deleted",
    (await page.evaluate(`${named("To do")}.querySelectorAll('.list-body > .note').length`)) === 1);
  await page.evaluate(`${named("To do")}.querySelector('.list-btn-more').click()`);
  await page.settle(250);
  await pick(page, "Delete list");
  await page.settle(600);

  check("deleting a list removes it", (await page.evaluate(count(".list"))) === 1);
  const kept = await liveNotes(page);
  check("but never the notes that were in it", kept.length === held, `${kept.length} of ${held}`);
  check("which spill back onto the board",
    (await page.evaluate(count("#world > .note"))) === 2);
  check("carrying no list with them", kept.every((n) => !n.listId));

  /* ----------------------------------------------------------------- undo */

  await page.key("z", "KeyZ", 2 /* ctrl */);
  await page.settle(700);
  check("undo brings the list back", (await page.evaluate(count(".list"))) === 2);
  check("and puts back what was in it", (await page.evaluate(count(".list-body > .note"))) === 1);
}
