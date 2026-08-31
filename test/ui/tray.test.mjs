// The Capture tray — the strip captures land in, and the drag that files them.
//
// The tray is a reserved page rendered as a filmstrip, so most of what is
// checked here is that being a page did not leak: it stays out of the sidebar,
// out of search, and off the board until somebody drags it there.

export const title = "tray";

const TRAY = "capture-tray";

// Seeding a capture rather than driving a real clip: the capture pipeline is
// covered by the clip suite, and captureVisibleTab needs a toolbar gesture no
// harness can produce. What matters here is what the tray does with the record.
const capture = (id, { title = "A page", ago = 0 } = {}) => ({
  id,
  x: 0,
  y: 0,
  width: 224,
  height: 226,
  html: `<img data-img-id="img-${id}"><p><a href="https://example.com/${id}">${title}</a></p>`,
  color: "transparent",
  z: 1,
  locked: false,
  createdAt: Date.now() - ago,
  editedAt: Date.now() - ago,
  updatedAt: Date.now() - ago,
  pageId: TRAY,
});

const trayPage = { id: TRAY, name: "Captures", parentId: null, order: -1, collapsed: false, updatedAt: Date.now() };

const count = (selector) => `document.querySelectorAll(${JSON.stringify(selector)}).length`;
const trayHeight = `parseInt(getComputedStyle(document.documentElement).getPropertyValue('--tray-h'), 10)`;

export default async function run(page, s) {
  /* ------------------------------------------------------- nothing captured */

  s.check("an empty tray renders nothing at all", (await page.evaluate(count("#tray.is-open"))) === 0);
  s.check("and costs the board no height", (await page.evaluate(trayHeight)) === 0);
  const fullHeight = await page.evaluate(`document.getElementById('canvas').getBoundingClientRect().bottom`);
  s.check(
    "so the canvas runs to the bottom of the window",
    Math.abs(fullHeight - (await page.evaluate(`window.innerHeight`))) < 2
  );

  /* ---------------------------------------------------------- with captures */

  await page.seed("pages", [trayPage]);
  await page.seed("notes", [
    capture("one", { title: "Newest find" }),
    capture("two", { title: "Yesterday's find", ago: 2 * 24 * 3600 * 1000 }),
    capture("three", { title: "Old find", ago: 30 * 24 * 3600 * 1000 }),
  ]);

  s.check("the strip appears once there is something in it", (await page.evaluate(count("#tray.is-open"))) === 1);
  s.check("with a thumbnail each", (await page.evaluate(count(".tray-item"))) === 3);
  s.check("and a count in the header", (await page.evaluate(`document.getElementById('tray-count').textContent`)) === "3");
  s.check("it takes its height out of the board", (await page.evaluate(trayHeight)) > 0);
  s.check(
    "the canvas gives up exactly that much",
    Math.abs(
      (await page.evaluate(`window.innerHeight - document.getElementById('canvas').getBoundingClientRect().bottom`)) -
        (await page.evaluate(trayHeight))
    ) < 2
  );

  s.check(
    "newest first, so the strip reads left to right in the order things were grabbed",
    (await page.evaluate(`[...document.querySelectorAll('.tray-item')].map(el => el.dataset.noteId).join(',')`)) ===
      "one,two,three"
  );

  const fades = await page.evaluate(`[...document.querySelectorAll('.tray-item')].map(el => +el.style.opacity)`);
  s.check("recent captures are at full strength", fades[0] === 1, String(fades));
  s.check("older ones fade, in order, but are never hidden", fades[1] > fades[2] && fades[2] > 0, String(fades));

  /* ---------------------------------------------------- a page, but not one */

  s.check("the tray is not a row in the sidebar", (await page.evaluate(count(`#page-tree [data-page-id="${TRAY}"]`))) === 0);
  s.check("and nothing was dropped on the board", (await page.evaluate(count("#world .note"))) === 0);

  await page.evaluate(`(async () => {
    const search = await import('./js/search.js');
    search.open();
    return true;
  })()`);
  await page.settle(400);
  s.check(
    "captures stay out of search — an unfiled one is already on screen",
    (await page.evaluate(`document.getElementById('search-results').textContent.includes('find')`)) === false,
    await page.evaluate(`document.getElementById('search-results').textContent`)
  );
  await page.key("Escape", "Escape");
  await page.settle(200);

  /* -------------------------------------------------------------- collapsing */

  const openHeight = await page.evaluate(trayHeight);
  await page.evaluate(`document.getElementById('tray-collapse').click()`);
  await page.settle(200);
  s.check("collapsing shrinks the strip to its header", (await page.evaluate(trayHeight)) < openHeight);
  s.check("and keeps every capture", (await page.evaluate(count(".tray-item"))) === 3);
  s.check(
    "the count is still readable while collapsed",
    (await page.evaluate(`getComputedStyle(document.getElementById('tray-count')).display`)) !== "none"
  );
  await page.evaluate(`document.getElementById('tray-collapse').click()`);
  await page.settle(200);
  s.check("and it opens back up", (await page.evaluate(trayHeight)) === openHeight);

  /* ------------------------------------------------- dragging one to a board */

  const box = await page.evaluate(`(() => {
    const r = document.querySelector('[data-note-id="one"]').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 20) };
  })()`);
  await page.drag(box.x, box.y, 120, -260);
  await page.settle(500);

  s.check("dragging a capture onto the board places it there", (await page.evaluate(count("#world .note"))) === 1);
  s.check("and it leaves the tray", (await page.evaluate(count(".tray-item"))) === 2);
  s.check("the count follows", (await page.evaluate(`document.getElementById('tray-count').textContent`)) === "2");

  const placed = (await page.stored("notes")).find((n) => n.id === "one");
  s.check("the record changed page rather than being copied", !!placed && placed.pageId !== TRAY);
  s.check("and landed where it was dropped, not at the origin", !!placed && (placed.x !== 0 || placed.y !== 0),
    placed && `${placed.x},${placed.y}`);

  /* ------------------------------------------- dragging one to a sidebar page */

  await page.evaluate(`(async () => {
    const pages = await import('./js/pages.js');
    await pages.createPage(null);
    document.activeElement.blur();
    return true;
  })()`);
  await page.settle(600);

  const target = await page.evaluate(`(() => {
    const rows = [...document.querySelectorAll('#page-tree .page-row')];
    const row = rows[rows.length - 1];
    const r = row.getBoundingClientRect();
    return { id: row.dataset.pageId, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);

  const thumb = await page.evaluate(`(() => {
    const r = document.querySelector('[data-note-id="two"]').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 20) };
  })()`);
  await page.drag(thumb.x, thumb.y, target.x - thumb.x, target.y - thumb.y);
  await page.settle(500);

  const filed = (await page.stored("notes")).find((n) => n.id === "two");
  s.check("dragging a capture onto a page row files it there", !!filed && filed.pageId === target.id, filed && filed.pageId);
  s.check("and it is gone from the tray", (await page.evaluate(count(".tray-item"))) === 1);

  /* ------------------------------------------------------- removing, and undo */

  await page.evaluate(`document.querySelector('[data-note-id="three"] .tray-remove').click()`);
  await page.settle(400);

  s.check("removing a capture empties the tray", (await page.evaluate(count(".tray-item"))) === 0);
  s.check("which means the strip disappears entirely again", (await page.evaluate(count("#tray.is-open"))) === 0);
  s.check("and the board gets its height back", (await page.evaluate(trayHeight)) === 0);
  s.check("it is a tombstone, not a deletion", (await page.stored("notes")).some((n) => n.id === "three" && n.deleted));
  s.check("and undo is offered", (await page.evaluate(count("#undo-bar.is-open"))) === 1);

  await page.evaluate(`document.getElementById('undo-btn').click()`);
  await page.settle(400);
  s.check("taking it brings the capture back", (await page.evaluate(count(".tray-item"))) === 1);
  s.check("into the tray, not onto the board", (await page.evaluate(count("#world .note"))) === 1);

  /* ------------------------------------------------------------- clear all */

  await page.seed("notes", [capture("four"), capture("five")]);
  s.check("a refilled tray shows everything in it", (await page.evaluate(count(".tray-item"))) === 3);

  await page.evaluate(`document.getElementById('tray-clear').click()`);
  await page.settle(400);
  s.check("Clear all empties it in one go", (await page.evaluate(count(".tray-item"))) === 0);
  s.check(
    "with no confirm dialog in the way — the undo bar is the confirmation",
    (await page.evaluate(count("#undo-bar.is-open"))) === 1
  );
  s.check(
    "and it says how many went",
    (await page.evaluate(`document.getElementById('undo-text').textContent`)) === "3 captures removed"
  );

  await page.evaluate(`document.getElementById('undo-btn').click()`);
  await page.settle(400);
  s.check("undo brings the whole batch back", (await page.evaluate(count(".tray-item"))) === 3);

  /* -------------------------------------------- clipping before ever opening */

  // The service worker can mint the tray on a profile that has never opened a
  // new tab, so the first board this page builds must not be the tray.
  await page.evaluate(`new Promise((resolve) => {
    const open = indexedDB.open('easynote');
    open.onsuccess = () => {
      const tx = open.result.transaction('pages', 'readwrite');
      tx.objectStore('pages').clear();
      tx.objectStore('pages').put(${JSON.stringify(trayPage)});
      tx.oncomplete = () => resolve(true);
    };
  })`);
  await page.cdp.send("Page.reload");
  await page.settle(1600);

  const pagesNow = await page.stored("pages");
  s.check(
    "a profile holding only the tray still gets a board to work on",
    pagesNow.some((p) => p.id !== TRAY && !p.deleted),
    pagesNow.map((p) => p.id).join(",")
  );
  s.check(
    "and the tray is not it",
    (await page.evaluate(count(`#page-tree [data-page-id="${TRAY}"]`))) === 0
  );
  s.check("the captures are still in the strip", (await page.evaluate(count(".tray-item"))) > 0);
}
