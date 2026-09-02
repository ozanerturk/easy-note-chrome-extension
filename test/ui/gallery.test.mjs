// Gallery mode: a picture opened at its own size, with every other picture on
// the board either side of it.
//
// The order is the thing worth pinning down — newest note first, wherever it
// lives, and within a note the order the images were written in — because it
// is the only order that still means something once the reel crosses pages.
// The second page is here for that crossing: a reel that stopped at the page
// edge would pass every check on one page alone.

export const title = "gallery";

const TWO = `<p>first note</p><img data-img-id="g1"><img data-img-id="g2">`;
const ONE = `<p>second note</p><img data-img-id="g3">`;
const AWAY = `<p>a note on the other page</p><img data-img-id="g4">`;

export default async function run(page, s) {
  const { check } = s;

  const home = (await page.stored("pages"))[0];
  // Distinct edit times, since that is what the reel is sorted by: note-b is
  // the most recent, then note-a, then the one on the other page.
  const at = (x, y, pageId, editedAt) => ({ x, y, width: 260, height: 330, z: 1, pageId,
    color: "transparent", createdAt: 1, editedAt, updatedAt: editedAt });

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
    { id: "note-a", html: TWO, ...at(320, 140, home.id, 2_000_000) },
    { id: "note-b", html: ONE, ...at(700, 140, home.id, 3_000_000) },
    { id: "note-c", html: AWAY, ...at(320, 140, "page-2", 1_000_000) },
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
    "the reel is the whole board, and opens on the picture that was clicked",
    (await count()) === "3 / 4",
    "g2 is the second image of the second-newest note, of four on the board"
  );
  check("the caption says where that note lives", (await text("gallery-where")) === home.name);
  check("and when it was last written in", (await text("gallery-when")).length > 0);

  /* ---------------------------------------------------------- navigating */

  await page.key("ArrowRight", "ArrowRight");
  await page.settle(200);
  check("the right arrow steps forward", (await count()) === "4 / 4");
  check(
    "and carries on into the oldest note, which is on the other page",
    (await text("gallery-where")) === "Trips"
  );

  await page.key("ArrowRight", "ArrowRight");
  await page.settle(150);
  check("past the end it wraps round", (await count()) === "1 / 4");
  check(
    "onto the picture in the note edited last",
    (await text("gallery-where")) === home.name
  );

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
    "which is the note edited last, back on the first page",
    (await page.evaluate(`document.querySelector('.note.is-selected')?.dataset.id`)) === "note-b"
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
