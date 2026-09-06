// Sync, driven against a fake Drive.
//
// runSync takes its `drive` as an argument precisely so it can be exercised
// with no network and no Google account, but nothing was doing it. These run in
// a real page rather than as a unit test because sync.js reaches note.js for
// imageIdsIn, and note.js reaches the DOM.
//
// What is really under test is the store registry: notes and pages used to be
// written out by hand, and a third kind of record meant editing four places.
// Now a store registers and the pass loops, so the checks are that a registered
// store goes up, comes down, and is counted.

export const title = "sync";

// One pass with a Drive that remembers what it was handed.
const PASS = (remote) => `(async () => {
  const sync = await import('./js/sync.js');
  const uploads = [];
  const files = ${remote ? `[{ id: 'doc1', name: 'easynote.json' }]` : `[]`};
  const drive = {
    list: async () => files,
    downloadText: async () => ${JSON.stringify(JSON.stringify(remote || {}))},
    downloadBlob: async () => new Blob([]),
    upload: async () => {},
    uploadJson: async (args) => { uploads.push(args); return { id: 'doc1' }; },
    remove: async () => {},
  };
  const summary = await sync.runSync({ drive });
  const last = uploads[uploads.length - 1];
  return { summary, uploaded: last ? last.data : null, uploads: uploads.length };
})()`;

export default async function run(page, s) {
  const { check } = s;

  const pageId = (await page.stored("pages"))[0].id;
  const now = Date.now();

  await page.seed("lists", [
    { id: "L1", pageId, name: "To do", x: 20, y: 20, width: 240, createdAt: now, updatedAt: now },
  ]);
  await page.seed("notes", [
    { id: "N1", pageId, x: 10, y: 10, width: 200, height: 150, html: "<p>in a list</p>",
      listId: "L1", listOrder: 1, createdAt: now, editedAt: now, updatedAt: now },
  ]);

  /* ------------------------------------------------------------- pushing up */

  let out = await page.evaluate(PASS(null));
  check("a first sync uploads the document", out.uploads === 1);
  check("carrying the notes", !!out.uploaded && out.uploaded.notes.length === 1);
  check("and the pages", !!out.uploaded && out.uploaded.pages.length >= 1);
  check("and the lists, which is the registry doing its job",
    !!out.uploaded && Array.isArray(out.uploaded.lists) && out.uploaded.lists.length === 1,
    JSON.stringify(out.uploaded && out.uploaded.lists));
  check("a list goes up whole", out.uploaded.lists[0].name === "To do");
  check("and a note keeps the list it is in",
    out.uploaded.notes[0].listId === "L1" && out.uploaded.notes[0].listOrder === 1);

  /* ---------------------------------------------------------- coming down */

  // A list this device has never seen, newer than anything local.
  const later = Date.now() + 1000;
  const remote = {
    version: 1,
    notes: [],
    pages: [],
    lists: [
      { id: "L2", pageId, name: "From the other device", x: 400, y: 40, width: 240,
        createdAt: later, updatedAt: later },
    ],
  };
  out = await page.evaluate(PASS(remote));
  check("a store that arrives from away is counted", out.summary.pulled.lists === 1,
    JSON.stringify(out.summary.pulled));

  const stored = await page.stored("lists");
  check("and written into the database", stored.some((l) => l.id === "L2"),
    JSON.stringify(stored.map((l) => l.id)));
  check("without losing the one that was already here", stored.some((l) => l.id === "L1"));

  // The panel reads this to say what moved; a store that reports nothing would
  // make a sync that pulled work look like a sync that did none.
  check("every registered store reports itself",
    ["notes", "pages", "lists"].every((k) => k in out.summary.pulled),
    Object.keys(out.summary.pulled).join(","));

  /* ------------------------------------------------- an older client's doc */

  // A document written before lists existed has no `lists` key at all. It must
  // merge against nothing rather than throwing, or one old client anywhere
  // breaks syncing for every new one.
  out = await page.evaluate(PASS({ version: 1, notes: [], pages: [] }));
  check("a document with no lists in it still syncs", out.summary.pulled.lists === 0,
    JSON.stringify(out.summary.pulled));
  check("and the lists here are pushed back into it",
    out.uploaded.lists.length === 2, String(out.uploaded && out.uploaded.lists.length));
}
