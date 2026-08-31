// Spring-loading: holding notes over a page opens it, so they can be put down
// somewhere chosen instead of posted into a page sight unseen.
//
// The interesting part is not the timer, it is that the drag survives the
// board being torn down and rebuilt underneath it.

export const title = "spring-load";

const SPRING_MS = 250;

const count = (selector) => `document.querySelectorAll(${JSON.stringify(selector)}).length`;
const currentPage = `document.querySelector('#page-tree .page-row.is-current').dataset.pageId`;

const rowBox = (id) => `(() => {
  const r = document.querySelector('#page-tree [data-page-id="${id}"]').getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;

// A drag that can be paused in the middle, which page.drag cannot do.
async function hold(page, from, over, { dwell, to }) {
  await page.mouse("mousePressed", from.x, from.y);
  await page.settle(40);
  for (let i = 1; i <= 6; i++) {
    await page.mouse("mouseMoved", from.x + ((over.x - from.x) * i) / 6, from.y + ((over.y - from.y) * i) / 6);
    await page.settle(20);
  }
  await page.settle(dwell);
  if (to) {
    for (let i = 1; i <= 6; i++) {
      await page.mouse("mouseMoved", over.x + ((to.x - over.x) * i) / 6, over.y + ((to.y - over.y) * i) / 6);
      await page.settle(20);
    }
    await page.mouse("mouseReleased", to.x, to.y, { buttons: 0 });
  } else {
    await page.mouse("mouseReleased", over.x, over.y, { buttons: 0 });
  }
  await page.settle(500);
}

export default async function run(page, s) {
  /* ------------------------------------------------------------- two pages */

  const home = (await page.stored("pages")).find((p) => !p.deleted).id;
  await page.evaluate(`(async () => {
    const pages = await import('./js/pages.js');
    await pages.createPage(null);
    document.activeElement.blur();
    await pages.switchPage(${JSON.stringify(home)});
    return true;
  })()`);
  await page.settle(700);

  const other = (await page.stored("pages")).map((p) => p.id).find((id) => id !== home);
  s.check("two pages to move between", !!other && (await page.evaluate(currentPage)) === home);

  const note = {
    id: "n1", x: 60, y: 60, width: 200, height: 150,
    html: "<p>carry me</p>", color: "transparent", z: 1, locked: false,
    createdAt: Date.now(), editedAt: Date.now(), updatedAt: Date.now(), pageId: home,
  };
  await page.seed("notes", [note]);
  s.check("a note on the page we start from", (await page.evaluate(count("#world .note"))) === 1);

  const grab = await page.evaluate(`(() => {
    const r = document.querySelector('#world .note').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 8) };
  })()`);
  const target = await page.evaluate(rowBox(other));

  /* -------------------------------------------------- passing over does not */

  await hold(page, grab, target, { dwell: 60, to: { x: grab.x + 40, y: grab.y + 40 } });

  s.check("passing over a page does not open it", (await page.evaluate(currentPage)) === home);
  s.check(
    "and the note stays where it was dropped, on its own page",
    (await page.stored("notes")).find((n) => n.id === "n1").pageId === home
  );

  /* --------------------------------------------------------- dwelling does */

  const grab2 = await page.evaluate(`(() => {
    const r = document.querySelector('#world .note').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 8) };
  })()`);

  // Pause on the row long enough for the spring, and check mid-gesture —
  // before letting go — that the page opened and the note is still in hand.
  await page.mouse("mousePressed", grab2.x, grab2.y);
  await page.settle(40);
  for (let i = 1; i <= 6; i++) {
    await page.mouse("mouseMoved", grab2.x + ((target.x - grab2.x) * i) / 6, grab2.y + ((target.y - grab2.y) * i) / 6);
    await page.settle(20);
  }

  // Caught just after arriving on the row: the countdown is showing and the
  // board has not changed yet. The window is only a quarter of a second, so
  // this is deliberately checked the moment the pointer lands.
  await page.settle(50);
  s.check("the row shows the page is about to open", (await page.evaluate(count(".page-row.is-springing"))) === 1);
  s.check("but has not opened yet", (await page.evaluate(currentPage)) === home);

  await page.settle(SPRING_MS + 250);
  s.check("holding over the page opens it, mid-drag", (await page.evaluate(currentPage)) === other);
  s.check("the countdown is over", (await page.evaluate(count(".page-row.is-springing"))) === 0);
  s.check(
    "the note is still in hand, not destroyed with the old board",
    (await page.evaluate(count("#drag-layer .note"))) === 1
  );
  s.check("and is not on the new board yet", (await page.evaluate(count("#world .note"))) === 0);
  s.check(
    "the record has not moved page until it is put down",
    (await page.stored("notes")).find((n) => n.id === "n1").pageId === home
  );

  // Now place it, which is the whole point of having opened the page.
  const drop = { x: target.x + 420, y: target.y + 300 };
  for (let i = 1; i <= 6; i++) {
    await page.mouse("mouseMoved", target.x + ((drop.x - target.x) * i) / 6, target.y + ((drop.y - target.y) * i) / 6);
    await page.settle(25);
  }
  const carried = await page.evaluate(`(() => {
    const r = document.querySelector('#drag-layer .note').getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top) };
  })()`);
  await page.mouse("mouseReleased", drop.x, drop.y, { buttons: 0 });
  await page.settle(500);

  const moved = (await page.stored("notes")).find((n) => n.id === "n1");
  s.check("dropping on the opened board moves the note there", moved.pageId === other, moved.pageId);
  s.check("and it is rendered on it", (await page.evaluate(count("#world .note"))) === 1);
  s.check("with nothing left in the drag layer", (await page.evaluate(count("#drag-layer .note"))) === 0);

  const landed = await page.evaluate(`(() => {
    const r = document.querySelector('#world .note').getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top) };
  })()`);
  s.check(
    "it lands where it was let go of, not somewhere on the page unseen",
    Math.abs(landed.x - carried.x) <= 2 && Math.abs(landed.y - carried.y) <= 2,
    `carried ${carried.x},${carried.y} → landed ${landed.x},${landed.y}`
  );

  /* ------------------------------------------- the old unplaced move still works */

  const homeRow = await page.evaluate(rowBox(home));
  const grab3 = await page.evaluate(`(() => {
    const r = document.querySelector('#world .note').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 8) };
  })()`);

  // Straight onto the row and released before the spring can fire.
  await hold(page, grab3, homeRow, { dwell: 40 });

  const back = (await page.stored("notes")).find((n) => n.id === "n1");
  s.check("dropping on a row without waiting still just files it there", back.pageId === home, back.pageId);
  s.check("the page did not spring open on the way", (await page.evaluate(currentPage)) === other);
  s.check("and the note left the board it was on", (await page.evaluate(count("#world .note"))) === 0);
  s.check("leaving nothing behind in the drag layer", (await page.evaluate(count("#drag-layer .note"))) === 0);

  /* ------------------------------------------ a capture springs a page too */

  // The tray drags a thumbnail rather than a rendered note, but it goes
  // through the same drop machinery, so it gets spring-loading for free.
  await page.seed("pages", [
    { id: "capture-tray", name: "Captures", parentId: null, order: -1, collapsed: false, updatedAt: Date.now() },
  ]);
  await page.seed("notes", [
    {
      id: "cap", x: 0, y: 0, width: 224, height: 226,
      html: '<img data-img-id="img-cap"><p><a href="https://example.com/c">Captured</a></p>',
      color: "transparent", z: 1, locked: false,
      createdAt: Date.now(), editedAt: Date.now(), updatedAt: Date.now(), pageId: "capture-tray",
    },
  ]);
  s.check("a capture waiting in the tray", (await page.evaluate(count(".tray-item"))) === 1);
  s.check("on the other page's board", (await page.evaluate(currentPage)) === other);

  const thumb = await page.evaluate(`(() => {
    const r = document.querySelector('.tray-item').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 18) };
  })()`);
  const homeRow2 = await page.evaluate(rowBox(home));

  await page.mouse("mousePressed", thumb.x, thumb.y);
  await page.settle(40);
  for (let i = 1; i <= 6; i++) {
    await page.mouse("mouseMoved", thumb.x + ((homeRow2.x - thumb.x) * i) / 6, thumb.y + ((homeRow2.y - thumb.y) * i) / 6);
    await page.settle(20);
  }
  await page.settle(SPRING_MS + 250);
  s.check("holding a capture over a page opens that page too", (await page.evaluate(currentPage)) === home);
  s.check("and the capture is still in hand", (await page.evaluate(count("#drag-layer .tray-item"))) === 1);

  const spot = { x: homeRow2.x + 460, y: homeRow2.y + 260 };
  for (let i = 1; i <= 6; i++) {
    await page.mouse("mouseMoved", homeRow2.x + ((spot.x - homeRow2.x) * i) / 6, homeRow2.y + ((spot.y - homeRow2.y) * i) / 6);
    await page.settle(25);
  }
  await page.mouse("mouseReleased", spot.x, spot.y, { buttons: 0 });
  await page.settle(600);

  const placed = (await page.stored("notes")).find((n) => n.id === "cap");
  s.check("dropping it on the opened board files it there", placed.pageId === home, placed.pageId);
  s.check("it leaves the tray", (await page.evaluate(count(".tray-item"))) === 0);
  s.check("and is on the board it was placed on", (await page.evaluate(count("#world .note"))) === 2);

  /* --------------------------------- dropping back home after springing away */

  // A note filed onto a page by a row drop keeps the world coordinates it had
  // on the page it left, so it can land under the sidebar or off-screen —
  // which is the very thing spring-loading exists to avoid. Frame the board
  // before grabbing one.
  await page.evaluate(`document.getElementById('fit').click()`);
  await page.settle(400);

  const onBoard = await page.evaluate(`(() => {
    const canvas = document.getElementById('canvas').getBoundingClientRect();
    const el = [...document.querySelectorAll('#world .note')].find((n) => {
      const r = n.getBoundingClientRect();
      return r.left > canvas.left + 10 && r.right < canvas.right - 10 && r.top > canvas.top + 10;
    });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 8) };
  })()`);
  const otherRow = await page.evaluate(rowBox(other));

  const under = await page.evaluate(
    "(() => { const el = document.elementFromPoint(" + onBoard.x + "," + onBoard.y + ");" +
      " return el ? el.className + '|' + (el.closest('.note') ? 'in-note' : 'outside') : 'nothing'; })()"
  );
  await page.mouse("mousePressed", onBoard.x, onBoard.y);
  await page.settle(40);
  for (let i = 1; i <= 6; i++) {
    await page.mouse("mouseMoved", onBoard.x + ((otherRow.x - onBoard.x) * i) / 6, onBoard.y + ((otherRow.y - onBoard.y) * i) / 6);
    await page.settle(20);
  }
  await page.settle(SPRING_MS + 250);
  s.check(
    "a page springs open on the way",
    (await page.evaluate(currentPage)) === other,
    `grab point: ${under}; in hand: ${await page.evaluate(count("#drag-layer .note"))}`
  );

  // Change of mind: back onto its own page's row, which is not a drop target.
  const homeRow3 = await page.evaluate(rowBox(home));
  for (let i = 1; i <= 6; i++) {
    await page.mouse("mouseMoved", otherRow.x + ((homeRow3.x - otherRow.x) * i) / 6, otherRow.y + ((homeRow3.y - otherRow.y) * i) / 6);
    await page.settle(20);
  }
  await page.mouse("mouseReleased", homeRow3.x, homeRow3.y, { buttons: 0 });
  await page.settle(500);

  const unmoved = (await page.stored("notes")).filter((n) => !n.deleted && n.pageId === home);
  s.check("letting go on its own page leaves the note on it", unmoved.length === 2, String(unmoved.length));
  s.check("nothing is stranded in the drag layer", (await page.evaluate(count("#drag-layer .note"))) === 0);
}
