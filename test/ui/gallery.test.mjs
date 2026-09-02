// Gallery mode: a picture opened at its own size, with every other picture on
// the board either side of it.
//
// The order is the thing worth pinning down — pages down the sidebar, notes
// down and across each page, images in writing order — because it is what
// makes paging through pictures feel like reading the board rather than
// shuffling it. The second page is here for the crossing: a reel that stopped
// at the page edge would pass every check on one page alone.

export const title = "gallery";

const TWO = `<p>first note</p><img data-img-id="g1"><img data-img-id="g2">`;
const ONE = `<p>second note</p><img data-img-id="g3">`;
const AWAY = `<p>a note on the other page</p><img data-img-id="g4">`;

export default async function run(page, s) {
  const { check } = s;

  const home = (await page.stored("pages"))[0];
  const at = (x, y, pageId) => ({ x, y, width: 260, height: 330, z: 1, pageId,
    color: "transparent", createdAt: 1, editedAt: 1, updatedAt: 1 });

  // Real blobs in the image store: an <img> with nothing behind it has no box
  // to double-click, so the pictures have to actually be there.
  await page.evaluate(`new Promise((resolve) => {
    const c = document.createElement('canvas');
    c.width = 80; c.height = 60;
    const g = c.getContext('2d');
    g.fillStyle = '#4d8fe0';
    g.fillRect(0, 0, 80, 60);
    c.toBlob((blob) => {
      const open = indexedDB.open('easynote');
      open.onsuccess = () => {
        const tx = open.result.transaction('images', 'readwrite');
        ['g1', 'g2', 'g3', 'g4'].forEach((id) => tx.objectStore('images').put({ id, blob }));
        tx.oncomplete = () => resolve(true);
      };
    });
  })`);

  await page.seed("pages", [{ id: "page-2", name: "Trips", parentId: null, order: 9, collapsed: false }]);
  await page.seed("notes", [
    { id: "note-a", html: TWO, ...at(320, 140, home.id) },
    { id: "note-b", html: ONE, ...at(700, 140, home.id) },
    { id: "note-c", html: AWAY, ...at(320, 140, "page-2") },
  ]);

  const text = (id) => page.evaluate(`document.getElementById('${id}').textContent`);
  const count = () => text("gallery-count");
  const open = () => page.evaluate(`!document.getElementById('gallery').hidden`);
  const boxOf = (sel) =>
    page.evaluate(`(() => {
      const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);

  check("nothing is up to begin with", (await open()) === false);

  /* ------------------------------------------------------------- opening */

  const g2 = await boxOf('img[data-img-id="g2"]');
  await page.click(g2.x, g2.y, 2);
  await page.settle();

  check("double-clicking a picture opens the gallery", (await open()) === true);
  check(
    "the reel is the whole board, not the page it was opened from",
    (await count()) === "2 / 4"
  );
  check("it names the note the picture came out of", (await text("gallery-summary")).includes("first note"));
  check("and where that note lives", (await text("gallery-where")) === home.name);

  /* ---------------------------------------------------------- navigating */

  await page.key("ArrowRight", "ArrowRight");
  await page.settle(150);
  check("the right arrow steps forward", (await count()) === "3 / 4");

  await page.key("ArrowRight", "ArrowRight");
  await page.settle(200);
  check("and carries on into the next page's pictures", (await count()) === "4 / 4");
  check("which the caption says out loud", (await text("gallery-where")) === "Trips");

  await page.key("ArrowRight", "ArrowRight");
  await page.settle(150);
  check("past the end it wraps round", (await count()) === "1 / 4");

  await page.key("ArrowLeft", "ArrowLeft");
  await page.settle(150);
  check("and back the other way", (await count()) === "4 / 4");

  const next = await boxOf("#gallery-next");
  await page.click(next.x, next.y);
  await page.settle(150);
  check("the arrow button does what the key does", (await count()) === "1 / 4");

  /* ---------------------------------------------------------- go to note */

  // The last frame is the picture on the page that is not on screen.
  await page.key("ArrowLeft", "ArrowLeft");
  await page.settle(150);

  const goto = await boxOf("#gallery-goto");
  await page.click(goto.x, goto.y);
  await page.settle(700);

  check("going to the note closes the gallery", (await open()) === false);
  check(
    "it opens the page that note lives on",
    (await page.evaluate(`document.querySelector('.page-row.is-current .page-name')?.textContent`)) === "Trips"
  );
  check(
    "and leaves that note the selected one",
    (await page.evaluate(`document.querySelector('.note.is-selected')?.dataset.id`)) === "note-c"
  );

  /* ------------------------------------------------- keys alone, then out */

  const g4 = await boxOf('img[data-img-id="g4"]');
  await page.click(g4.x, g4.y, 2);
  await page.settle();
  check("a picture opens on its own frame, wherever it is", (await count()) === "4 / 4");

  // Arrows to look, Enter to go there — the mouse never has to be touched.
  await page.key("ArrowRight", "ArrowRight");
  await page.settle(150);
  check("stepping past the last frame lands on the first", (await count()) === "1 / 4");

  await page.key("Enter", "Enter");
  await page.settle(700);
  check("Enter goes to the note the picture is in", (await open()) === false);
  check(
    "which is the note that picture belongs to",
    (await page.evaluate(`document.querySelector('.note.is-selected')?.dataset.id`)) === "note-a"
  );

  const g1 = await boxOf('img[data-img-id="g1"]');
  await page.click(g1.x, g1.y, 2);
  await page.settle();

  await page.key("Escape", "Escape");
  await page.settle(150);
  check("Escape closes it", (await open()) === false);
  check(
    "and stops there — the board is not sent home as well",
    (await page.evaluate(`document.querySelectorAll('.note').length`)) === 2
  );
}
