// A note that floats over every webpage.
//
// Two halves. On the board the test is that nothing changed: the note stays in
// #world, in its place, moving and zooming with everything else, wearing a mark
// that says it is also out there. On a webpage the test is that it is the same
// note — drawn by the board's own code in a frame of the extension's own, doing
// there what it does on the board, on a page that does its best to get in the way.

import fs from "node:fs";
import http from "node:http";
import { launch, withHostAccess, sleep } from "./harness.mjs";

export const title = "floating";

const noteMenu = async (page, id) => {
  await page.evaluate(`document.querySelector('[data-id="${id}"] .note-btn-more').click()`);
  await page.settle(250);
};
const pick = async (page, label) => {
  await page.evaluate(
    `[...document.querySelectorAll('.ctx-item')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`
  );
  await page.settle(350);
};
const hasItem = (page, label) =>
  page.evaluate(
    `[...document.querySelectorAll('.ctx-item')].some((b) => b.textContent === ${JSON.stringify(label)})`
  );

const boxOf = (page, id) =>
  page.evaluate(`(() => {
    const el = document.querySelector('[data-id="${id}"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left), y: Math.round(r.top),
      width: Math.round(r.width), height: Math.round(r.height),
      // Where it is laid out, which the drift does not move: the drift is a
      // translate, and it starts each note at its own point in the swell.
      left: el.offsetLeft, top: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight,
      inWorld: !!el.closest('#world'),
      marked: el.classList.contains('is-floating'),
      lifted: getComputedStyle(el).boxShadow,
      animation: getComputedStyle(el).animationName,
    };
  })()`);

const recordOf = async (page, id) => (await page.stored("notes")).find((n) => n.id === id);

// Typing on a webpage reaches the database by way of a debounce and the
// worker, which takes as long as it takes on a busy machine. Wait for the
// words rather than for a guess at how long that is.
const storedWith = (page, words) =>
  page
    .waitFor(`new Promise((resolve) => {
      const open = indexedDB.open('easynote');
      open.onsuccess = () => {
        const req = open.result.transaction('notes', 'readonly').objectStore('notes').getAll();
        req.onsuccess = () => resolve(req.result.some((n) => (n.html || '').includes(${JSON.stringify(words)})));
      };
    })`, { timeout: 8000, every: 100 })
    .catch(() => false);

export default async function run(page, s) {
  const { check } = s;

  // Granting host access is a real Chrome prompt waiting on a person, and no
  // test can answer one. The answer is stubbed; what is under test is what the
  // board does once it has been given, not the dialog itself.
  await page.evaluate(`(() => {
    chrome.permissions.contains = () => Promise.resolve(true);
    chrome.permissions.request = () => Promise.resolve(true);
  })()`);

  await page.click(600, 400, 2);
  await page.type("floats");
  await page.settle();
  const id = await page.evaluate(`document.querySelector('.note').dataset.id`);
  const before = await boxOf(page, id);
  const placed = await recordOf(page, id);

  check("a new note is on the board", before.inWorld === true);
  check("and is not marked as floating", before.marked === false);

  /* ------------------------------------------------------------- floating */

  await noteMenu(page, id);
  check("a single note can be floated from its menu", (await hasItem(page, "Float")) === true);
  await pick(page, "Float");

  const floated = await boxOf(page, id);
  // The whole of the change on the board: a mark, and nothing else.
  check("floating leaves the note on the board", floated.inWorld === true);
  check("in exactly the same place, at the same size",
    floated.left === before.left && floated.top === before.top &&
      floated.w === before.w && floated.h === before.h,
    `${floated.left},${floated.top} ${floated.w}x${floated.h} was ${before.left},${before.top} ${before.w}x${before.h}`);
  check("marked, so you can tell it is floating", floated.marked === true);
  check("with a lift the plain note did not have", floated.lifted !== before.lifted);
  check("and a bob to say so", floated.animation === "note-afloat");
  const ground = await page.evaluate(`(() => {
    const s = getComputedStyle(document.querySelector('[data-id="${id}"]'), '::after');
    return { content: s.content, animation: s.animationName };
  })()`);
  check("with a shadow on the ground under it, growing and shrinking as it bobs",
    ground.content !== "none" && ground.animation === "note-afloat-shadow", JSON.stringify(ground));
  // Its place in the bob, against the page's own clock: every floating note on
  // that clock is every floating note rising and falling together.
  const offClock = await page.evaluate(`(() => {
    const a = document.querySelector('[data-id="${id}"]').getAnimations().find((x) => x.animationName === 'note-afloat');
    if (!a) return null;
    const P = 1500;
    const phase = (((a.currentTime - a.effect.getTiming().delay) % P) + P) % P;
    const off = Math.abs(phase - (document.timeline.currentTime % P));
    return Math.round(Math.min(off, P - off));
  })()`);
  check("on the page's clock, so every floating note bobs in step", offClock !== null && offClock < 80, `${offClock}ms off`);

  let record = await recordOf(page, id);
  check("the record says it is floating", record.floating === true);
  check("its place on the board is untouched",
    record.x === placed.x && record.y === placed.y);

  /* ------------------------------------------- it is still an ordinary note */

  // The earlier build lifted a floating note into a fixed layer, which took it
  // out of the canvas and cost it every gesture a note has. It is a note.
  await page.evaluate(`document.getElementById('zoom-in').click()`);
  await page.settle(300);
  const zoomed = await boxOf(page, id);
  const view = await page.view();
  check("the board zoomed", view.zoom > 1.2, `zoom ${view.zoom}`);
  check("and a floating note zooms with it, like everything else on the board",
    zoomed.width > before.width, `${zoomed.width} was ${before.width}`);
  await page.evaluate(`document.getElementById('zoom-level').click()`);
  await page.settle(300);

  // Step out of the note first. The board refuses to drag a note by the words
  // you are writing in it — that gesture selects text — so a test that grabs
  // an open note by its text is testing that rule, not this one.
  await page.click(300, 650);
  await page.settle(200);
  const dragFrom = await boxOf(page, id);
  await page.drag(dragFrom.x + 40, dragFrom.y + 10, 120, 80);
  await page.settle(400);
  const dragged = await boxOf(page, id);
  check("a floating note still drags on the board",
    Math.abs(dragged.left - (dragFrom.left + 120)) <= 4 && Math.abs(dragged.top - (dragFrom.top + 80)) <= 4,
    `${dragged.left},${dragged.top} from ${dragFrom.left},${dragFrom.top}`);
  record = await recordOf(page, id);
  check("and the move is written down", record.x !== placed.x || record.y !== placed.y);
  check("while it keeps floating", record.floating === true);

  // Floating must not touch the note's own size. It used to: the old build gave
  // a floating note a viewport-sized box and wrote that back over the board's.
  const sized = await recordOf(page, id);
  check("floating never changes the note's size on the board",
    sized.width === placed.width && sized.height === placed.height,
    `${sized.width}x${sized.height} was ${placed.width}x${placed.height}`);

  /* ----------------------------------------------------------- un-floating */

  const held = await recordOf(page, id);
  await noteMenu(page, id);
  check("a floating note is offered the way back", (await hasItem(page, "Unfloat")) === true);
  await page.key("Escape", "Escape");
  await page.settle(150);
  await noteMenu(page, id);

  const wasAt = await recordOf(page, id);
  await pick(page, "Unfloat");
  await page.settle(300);
  const unfloated = await boxOf(page, id);
  check("un-floating takes the mark off", unfloated.marked === false);
  check("and the bob stops", unfloated.animation !== "note-afloat", unfloated.animation);
  check("the note stays on the board", unfloated.inWorld === true);
  // Its place, not the pixel it is drawn at: the bob moves that by a few pixels
  // on purpose, so reading the screen here would be reading the animation.
  const nowAt = await recordOf(page, id);
  check("and the note does not move an inch",
    nowAt.x === wasAt.x && nowAt.y === wasAt.y,
    `${nowAt.x},${nowAt.y} was ${wasAt.x},${wasAt.y}`);
  record = await recordOf(page, id);
  check("the record stops floating", !record.floating);
  check("its place on the board is still its own",
    record.x === held.x && record.y === held.y);

  /* --------------------------------------------------- Escape puts it away */

  await noteMenu(page, id);
  await pick(page, "Float");
  await page.evaluate(`document.querySelector('[data-id="${id}"] .note-body').click()`);
  await page.settle(250);
  await page.key("Escape", "Escape");
  await page.settle(400);
  check("Escape on an open floating note unfloats it", !(await recordOf(page, id)).floating);
  check("and the note is still exactly where it was",
    (await recordOf(page, id)).x === held.x);

  /* --------------------------------------------- it survives a page switch */

  await noteMenu(page, id);
  await pick(page, "Float");
  await page.evaluate(`document.getElementById('add-page').click()`);
  await page.settle(500);
  check("a floating note is not dragged onto whatever page you open",
    (await boxOf(page, id)) === null);
  check("but it is still floating", (await recordOf(page, id)).floating === true);

  await page.reload();
  await page.settle(300);
  check("and still floating after a reload", (await recordOf(page, id)).floating === true);

  /* ------------------------------------ where the action is not offered */

  await page.click(500, 300, 2);
  await page.type("one");
  await page.settle();
  await page.click(900, 500, 2);
  await page.type("two");
  await page.settle();

  await page.click(300, 200);
  await page.settle(120);
  await page.drag(400, 180, 620, 420);
  await page.settle(250);

  const many = await page.evaluate(`document.querySelectorAll('#world .note.is-selected').length`);
  check("two notes can be selected together", many > 1, `${many} selected`);
  const someId = await page.evaluate(`document.querySelector('#world .note.is-selected').dataset.id`);
  await noteMenu(page, someId);
  check("floating is not offered for a selection of notes",
    (await hasItem(page, "Float")) === false);
  check("but the list action still is, which is what a selection is for",
    (await hasItem(page, `Put these ${many} notes in a list`)) === true);
  await page.key("Escape", "Escape");
  await page.settle(150);

  /* --------------------------------------------- a blank line is a line */

  // An empty paragraph between two written ones. The editor draws one with a
  // <br> in it; what we store is a bare <p>, which had no line box and so the
  // gap vanished the moment the note stopped being edited.
  await page.click(700, 250, 2);
  await page.typeKeys("first\n\nsecond");
  await page.settle(300);
  const spaced = await page.evaluate(`document.querySelector('.note.is-active').dataset.id`);
  const openHeight = await page.evaluate(
    `document.querySelector('[data-id="${spaced}"] .note-body').scrollHeight`
  );
  // Step out of it, so the body is the stored markup again rather than the
  // editor's own document — which is where the gap used to disappear.
  await page.key("Escape", "Escape");
  await page.waitFor(`!document.querySelector('[data-id="${spaced}"] .ProseMirror')`);
  await page.settle(200);
  const idleShape = await page.evaluate(`(() => {
    const b = document.querySelector('[data-id="${spaced}"] .note-body');
    const empty = b.querySelector('p:empty');
    return {
      height: b.scrollHeight,
      paragraphs: b.querySelectorAll('p').length,
      emptyHeight: empty ? Math.round(empty.getBoundingClientRect().height) : null,
    };
  })()`);
  check("an empty line is stored as a paragraph of its own", idleShape.paragraphs === 3,
    `${idleShape.paragraphs} paragraphs`);
  check("and it still takes up a line once the note is idle",
    idleShape.emptyHeight > 8, `${idleShape.emptyHeight}px`);
  check("so the note does not shrink when you step out of it",
    idleShape.height >= openHeight - 4, `${idleShape.height} was ${openHeight}`);

  /* ------------------------------------ a note made out on a webpage */

  // In the real service worker, not imported into this page. Worker code used
  // to be tested by importing it here, which is a different thing wearing the
  // same name — see the note on page.worker() in harness.mjs.
  const worker = await page.worker();
  await worker.evaluate(
    `self.easynoteFloat.createFloating(
       { selectionText: 'grabbed while reading', pageUrl: 'https://example.com/a' }, null
     ).then(() => true)`
  );
  await page.settle(500);

  const fromWeb = (await page.stored("notes")).find((n) => (n.html || "").includes("grabbed while reading"));
  check("right-clicking a webpage makes a note of the selection", !!fromWeb);
  // The tray, not a board. It came from out there and nobody has said where it
  // belongs — exactly a clip's case, so exactly a clip's answer.
  check("and it lands in the Capture tray, like a clip",
    !!fromWeb && fromWeb.pageId === "capture-tray", fromWeb && fromWeb.pageId);
  check("floating straight away", !!fromWeb && fromWeb.floating === true);
  check("carrying where it came from", !!fromWeb && fromWeb.html.includes("https://example.com/a"));

  const trayPage = (await page.stored("pages")).find((p) => p.id === "capture-tray");
  check("the Captures page is made on first use", !!trayPage && !trayPage.deleted);

  // It must still be in the tray after the board has had a look at it: a note
  // on a page this tab has never heard of is exactly what orphan adoption
  // drags onto the default board.
  await page.reload();
  await page.settle(300);
  const afterBoard = (await page.stored("notes")).find((n) => n.id === fromWeb.id);
  check("and the board leaves it in the tray rather than adopting it",
    !!afterBoard && afterBoard.pageId === "capture-tray", afterBoard && afterBoard.pageId);
  const trayCard = await page.evaluate(`(() => {
    const card = document.querySelector('#tray-items .tray-item');
    if (!card) return null;
    const words = card.querySelector('.tray-words');
    const img = card.querySelector('img.tray-shot');
    return { words: words ? words.textContent.trim() : null, hasBlankImage: !!img && !img.getAttribute('src') };
  })()`);
  check("the tray shows it", !!trayCard);
  // It used to be an <img> with no src: a blank grey rectangle standing where
  // the note should be. A capture that is words shows its words.
  check("and a capture made of words shows them, not an empty thumbnail",
    !!trayCard && !!trayCard.words && trayCard.words.includes("grabbed while reading"),
    trayCard && trayCard.words);
  check("with no blank picture frame in the card", !!trayCard && trayCard.hasBlankImage === false);

  // With no selection it is simply an empty note to write in.
  await worker.evaluate(
    `self.easynoteFloat.createFloating({ pageUrl: 'https://example.com/b' }, null).then(() => true)`
  );
  await page.settle(400);
  const empties = (await page.stored("notes")).filter((n) => n.floating && !n.html);
  check("right-clicking with nothing selected makes an empty floating note", empties.length === 1);

  /* ------------------------------------------- the same note, on a webpage */

  await onAWebpage(s);
}

// A site that wants nothing to do with us. Its CSP refuses frames and scripts
// from anywhere, it is dark, and its stylesheet goes after every iframe and
// every element it can reach. The note has to arrive intact regardless, and
// leave the page as it found it.
const HOSTILE = [
  "default-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "script-src 'none'",
  "img-src 'none'",
  "style-src 'unsafe-inline'",
].join("; ");

const SITE = `<!doctype html>
<html><head><meta charset="utf-8"><title>somebody else's page</title>
<style>
  :root { color-scheme: dark; background: #1d2733; color: #eee; }
  * { font-family: "Comic Sans MS", cursive !important; box-sizing: content-box !important; }
  iframe { border: 6px solid red !important; width: 100% !important; height: 90px !important;
           position: static !important; opacity: 0.3 !important; }
  body { margin: 0; min-height: 2400px; }
</style></head>
<body><h1 id="content">An article</h1><p>Being read.</p></body></html>`;

// Poll something outside any one page — the database, say — until it answers.
async function until(read, timeout = 8000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await read().catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) return null;
    await sleep(100);
  }
}

const yes = (promise) => promise.then(() => true, () => false);

// Chrome only routes input into a frame inside a tab it is actually drawing,
// so whichever tab is about to be driven comes to the front first.
const front = (page) => page.cdp.send("Page.bringToFront").catch(() => {});

// Several windows, and headless Chrome gives the keyboard to one of them: a key
// sent to any other is dropped. Each document here is told it has focus, which
// is what it would have with a person switching to it.
const focused = (page) => page.cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});

const focusOf = (page) =>
  page.evaluate(`({ has: document.hasFocus(), active: document.activeElement ? (document.activeElement.className || document.activeElement.tagName) : null })`).catch((e) => String(e));

// A pointer arriving the way a hand brings it, a few steps at a time. One
// synthetic jump straight onto a frame is not reliably hit-tested into it.
async function reachFor(page, { x, y }) {
  for (let i = 5; i >= 0; i--) {
    await page.move(x - i * 4, y - i * 3);
    await sleep(20);
  }
}

async function onAWebpage({ check }) {
  const server = http.createServer((req, res) => {
    const headers = { "content-type": "text/html; charset=utf-8" };
    // /open is the same page with no policy at all, so the page's own scripts
    // are free to make frames of their own.
    if (!req.url.startsWith("/open")) headers["content-security-policy"] = HOSTILE;
    res.writeHead(200, headers);
    res.end(SITE);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const site = `http://127.0.0.1:${server.address().port}/`;

  // Its own Chrome, holding access to every site from the start: the real
  // permission prompt is not something a test can click through.
  const extension = withHostAccess();
  const browser = await launch({ port: 9720, extension, headless: !process.argv.includes("--headed") });
  try {
    await webpage(browser, site, check);
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(extension, { recursive: true, force: true });
  }
}

async function webpage(browser, site, check) {
  const board = await browser.page();
  await board.reset();
  await focused(board);

  // A picture in the database, and a note on the board that shows it.
  await board.evaluate(`(async () => {
    const { put, IMAGES } = await import('./js/db.js');
    const canvas = new OffscreenCanvas(40, 30);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#c0ffee';
    ctx.fillRect(0, 0, 40, 30);
    await put(IMAGES, { id: 'img-afloat', blob: await canvas.convertToBlob({ type: 'image/png' }) });
    return true;
  })()`);
  const now = Date.now();
  await board.seed("notes", [{
    id: "afloat", x: 320, y: 220, width: 260, height: 190,
    html: '<p>written on the board</p><img data-img-id="img-afloat"><p>after the picture</p>',
    color: "#fff6a3", z: 1, createdAt: now, editedAt: now, updatedAt: now,
  }]);

  await noteMenu(board, "afloat");
  await pick(board, "Float");
  const onBoard = await recordOf(board, "afloat");

  // A window of its own, so the board and the page are both being drawn and
  // working in one never leaves the other unable to take input.
  const web = await browser.open(site, { newWindow: true });
  await focused(web);
  await front(web);
  const FRAME = (id) =>
    `[...document.querySelectorAll('iframe')].find((i) => { try { return new URL(i.src).searchParams.get('id') === ${JSON.stringify(id)}; } catch (e) { return false; } })`;

  const arrived = await yes(web.waitFor(`!!${FRAME("afloat")}`, { timeout: 15000 }));
  check("[web] a page opened after floating has the note on it", arrived);
  if (!arrived) return;
  const frame = await browser.frame("float.html?id=afloat");
  await focused(frame);
  const drawn = await yes(frame.waitFor(`!!document.querySelector('.note[data-id="afloat"] .note-body')`, { timeout: 15000 }));
  check("[web] drawn inside a frame of the extension's own", drawn);
  if (!drawn) return;

  const frameBox = () => web.evaluate(`(() => {
    const f = ${FRAME("afloat")};
    if (!f) return null;
    const r = f.getBoundingClientRect();
    const st = getComputedStyle(f);
    return { x: r.left, y: r.top, width: Math.round(r.width), height: Math.round(r.height), vw: innerWidth, vh: innerHeight,
             onHtml: f.parentElement === document.documentElement, position: st.position,
             border: st.borderTopWidth, opacity: st.opacity, scheme: st.colorScheme, clip: st.clipPath };
  })()`);
  const rectIn = (selector) => frame.evaluate(`(() => {
    const e = document.querySelector(${JSON.stringify(selector)});
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height, right: r.right, bottom: r.bottom,
             cx: r.left + r.width / 2, cy: r.top + r.height / 2, vw: innerWidth, vh: innerHeight };
  })()`);
  // The frame covers the viewport, so where something is in the frame is where
  // it is on the page.
  const onPage = async (selector) => {
    const r = await rectIn(selector);
    return r ? { x: r.cx, y: r.cy } : null;
  };
  // What the page would do with a click at a point: hand it to our frame, or
  // keep it. Chrome's hit testing follows the clip, and so does this.
  const takes = (x, y) => web.evaluate(`(() => { const hit = document.elementFromPoint(${x}, ${y}); return !!hit && hit === ${FRAME("afloat")}; })()`);
  // Both halves: the page has changed the clip, and the frame has decided it.
  const framedAs = (state, test) =>
    yes(web.waitFor(`(() => { const f = ${FRAME("afloat")}; return !!f && (${test}); })()`, { timeout: 5000 })
      .then(() => frame.waitFor(`document.documentElement.dataset.frame === '${state}'`, { timeout: 5000 })));
  const expanded = () => framedAs("whole", "getComputedStyle(f).clipPath === 'none'");
  const fitted = () => framedAs("fitted", "getComputedStyle(f).clipPath !== 'none'");
  const NOTE = '.note[data-id="afloat"]';

  /* ------------------------------------------------------ the same note */

  const face = await frame.evaluate(`(() => {
    const n = document.querySelector('${NOTE}');
    const b = n.querySelector('.note-body');
    return { more: !!n.querySelector('.note-header .note-btn-more'), footer: !!n.querySelector('.note-footer'),
      grip: !!n.querySelector('.note-grip'), words: b.textContent, fill: getComputedStyle(n).backgroundColor,
      font: getComputedStyle(b).fontFamily, sizing: getComputedStyle(b).boxSizing,
      scheme: getComputedStyle(document.documentElement).colorScheme,
      ground: getComputedStyle(document.body).backgroundColor };
  })()`);
  check("[web] it is the board's own note: its menu, its footer, its resize grip", face.more && face.footer && face.grip);
  check("[web] saying what it says on the board", face.words.includes("written on the board"), face.words);
  check("[web] in the colour it was given", face.fill === "rgb(255, 246, 163)", face.fill);
  const card = await frame.evaluate(`(() => { const r = document.querySelector('${NOTE}').getBoundingClientRect(); return { width: Math.round(r.width), height: Math.round(r.height), vw: innerWidth }; })()`);
  // A frame that ran before it had any size once clamped the note against a
  // viewport of nothing, and it came out a speck in the corner.
  check("[web] at the size it floats at, not squeezed by a frame that was not laid out yet",
    card.width >= 250 && card.height >= 170, JSON.stringify(card));
  const pictured = await yes(frame.waitFor(
    `(() => { const i = document.querySelector('${NOTE} img[data-img-id="img-afloat"]'); return !!i && i.naturalWidth > 0; })()`,
    { timeout: 8000 }
  ));
  check("[web] its picture is drawn, out of the extension's own database", pictured);

  /* ------------------------------------------------ and the page it is on */

  const rest = await frameBox();
  check("[web] the page's stylesheet does not reach inside it",
    !/comic/i.test(face.font) && face.sizing === "border-box", `${face.font} / ${face.sizing}`);
  check("[web] nor restyle the frame itself",
    rest.position === "fixed" && rest.border === "0px" && rest.opacity === "1", JSON.stringify(rest));
  check("[web] hung on the document element, where a transformed body cannot carry it", rest.onHtml);
  // Chrome paints a frame opaque — over the page — when the frame's colour
  // scheme and its element's disagree, and this page is dark.
  check("[web] see-through on a dark page: the frame and its element agree on a colour scheme",
    rest.scheme === face.scheme, `${rest.scheme} / ${face.scheme}`);
  check("[web] and the frame paints no ground of its own", face.ground === "rgba(0, 0, 0, 0)", face.ground);
  check("[web] the page's own content is left alone",
    await web.evaluate(`!!document.getElementById('content') && document.body.children.length === 2`));
  const noteCentre = await onPage(`.note[data-id="afloat"] .note-body`);
  check("[web] at rest the frame is clipped to the note", rest.clip !== "none", rest.clip);
  {
    // inset(top calc(100% - right) calc(100% - bottom) left), in the page's pixels
    const [top, right, bottom, left] = (rest.clip.match(/-?[\d.]+px/g) || []).map(parseFloat);
    const card = await rectIn('.note[data-id="afloat"]');
    // The floating note's shadow drops 6px and blurs 20px: it reaches about 26px
    // below the card and 14px above. A flat 10px margin used to cut it off.
    check("[web] with room left for the whole of its shadow",
      bottom >= card.bottom + 24 && top <= card.y - 12 && left <= card.x - 18 && right >= card.right + 18,
      `clip ${[top, right, bottom, left]} card ${[card.y, card.right, card.bottom, card.x].map(Math.round)}`);
  }
  check("[web] so a click beside the note is the page's",
    (await takes(rest.vw - 30, rest.vh - 30)) === false && (await takes(noteCentre.x, noteCentre.y)) === true);

  /* ------------------------------------------------------------- reaching */

  const cardAtRest = await rectIn(NOTE);
  const centre = await onPage(`${NOTE} .note-body`);
  await reachFor(web, centre);
  check("[web] reaching for the note gives it the whole viewport to open things in", await expanded());
  const cardReached = await rectIn(NOTE);
  check("[web] without the note moving on the page",
    Math.abs(cardReached.x - cardAtRest.x) <= 1 && Math.abs(cardReached.y - cardAtRest.y) <= 1,
    `${cardReached.x},${cardReached.y} was ${cardAtRest.x},${cardAtRest.y}`);
  await reachFor(web, { x: rest.vw - 30, y: rest.vh - 30 });
  check("[web] and moving off it hands the page back", await fitted());

  /* -------------------------------------------------------------- writing */

  await reachFor(web, centre);
  await expanded();
  const line = await rectIn(`${NOTE} .note-body p`);
  await web.click(line.x + 150, line.cy);
  const editing = await yes(frame.waitFor(`!!document.querySelector('${NOTE} .ProseMirror')`, { timeout: 5000 }));
  check("[web] clicking into it opens the board's editor", editing);
  await web.typeKeys(" and on the web");
  const toBoard = await yes(board.waitFor(
    `(document.querySelector('[data-id="afloat"] .note-body') || { textContent: '' }).textContent.includes('and on the web')`,
    { timeout: 8000 }
  ));
  check("[web] what is typed on the page is on the board, with no reload", toBoard);

  await web.typeKeys("\n- a bullet");
  await storedWith(board, "a bullet");
  const typed = await recordOf(board, "afloat");
  check("[web] \"- \" makes a bullet, as it does on the board", /<ul/.test(typed.html), typed.html.slice(0, 160));
  check("[web] the picture is still in the note", typed.html.includes('data-img-id="img-afloat"'));
  check("[web] named by its id, not stored as an address", !/src="(blob:|data:)/.test(typed.html));

  /* --------------------------------------------------- the formatting bar */

  await web.key("a", "KeyA", 4);
  const barUp = await yes(frame.waitFor(`!!document.querySelector('.bubble')`, { timeout: 5000 }));
  check("[web] selecting text brings up the formatting bar", barUp);
  if (barUp) {
    const bar = await frame.evaluate(`(() => {
      const b = document.querySelector('.bubble');
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { onTop: !!hit && b.contains(hit),
               inside: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
               buttons: b.querySelectorAll('.bubble-btn').length, box: [r.left, r.top, r.width, r.height].map(Math.round) };
    })()`);
    check("[web] the bar is on top of the note, not underneath it", bar.onTop, JSON.stringify(bar));
    check("[web] and all of it is on screen", bar.inside, JSON.stringify(bar.box));
    check("[web] with its buttons", bar.buttons > 0, `${bar.buttons}`);
  }
  await web.key("ArrowRight", "ArrowRight");

  /* ------------------------------------------------------ clicking away */

  await reachFor(web, { x: rest.vw - 30, y: rest.vh - 30 });
  await fitted();
  await web.click(rest.vw - 30, rest.vh - 30);
  check("[web] clicking the page steps out of the note, as clicking the board does",
    await yes(frame.waitFor(`!document.querySelector('${NOTE} .ProseMirror')`, { timeout: 5000 })));

  /* ------------------------------------------------ and back the other way */

  await front(board);
  const boardLine = await board.evaluate(`(() => {
    const r = document.querySelector('[data-id="afloat"] .note-body p').getBoundingClientRect();
    return { x: r.left + 40, y: r.top + r.height / 2 };
  })()`);
  await board.click(boardLine.x, boardLine.y);
  await board.waitFor(`!!document.querySelector('[data-id="afloat"] .ProseMirror')`);
  // The editor takes the caret a frame after it mounts, not as it mounts.
  await yes(board.waitFor(`!!document.activeElement && document.activeElement.classList.contains('ProseMirror')`, { timeout: 5000 }));
  const boardFocus = await focusOf(board);
  // Inserted rather than keyed: the board's window is not the one with the
  // keyboard now, and what is under test is the words arriving, not the keys.
  await board.type(" and back");
  const toWeb = await yes(frame.waitFor(
    `document.querySelector('${NOTE} .note-body').textContent.includes('and back')`,
    { timeout: 8000 }
  ));
  check("[web] what is typed on the board is on the page, with no reload", toWeb,
    toWeb ? "" : JSON.stringify({
      stored: (await recordOf(board, "afloat")).html.slice(0, 80),
      framed: (await frame.evaluate(`document.querySelector('${NOTE} .note-body').textContent`)).slice(0, 80),
      boardFocus,
    }));
  // Stepping out on the board by clicking it — Escape there would put the note away.
  await board.click(900, 130);
  await board.settle(200);

  /* ------------------------------------------- filed while it floats */

  // Where a note sits on its board changes without the frame hearing of it —
  // a capture dropped onto a page, a note filed away — and the frame's own copy
  // of the record still says where it was. Writing that copy back put the note
  // straight back where it came from.
  const filed = { x: onBoard.x + 40, y: onBoard.y + 30 };
  await board.evaluate(`(async () => {
    const { put, getOne, NOTES } = await import('./js/db.js');
    const n = await getOne(NOTES, 'afloat');
    await put(NOTES, { ...n, x: ${filed.x}, y: ${filed.y}, updatedAt: Date.now() });
    return true;
  })()`);
  await front(web);
  const toWrite = await onPage(`${NOTE} .note-body p`);
  await reachFor(web, toWrite);
  await expanded();
  await web.click(toWrite.x, toWrite.y);
  await yes(frame.waitFor(`!!document.querySelector('${NOTE} .ProseMirror')`, { timeout: 5000 }));
  await web.typeKeys(" filed");
  await storedWith(board, " filed");
  const afterFiling = await recordOf(board, "afloat");
  check("[web] writing in it on the page leaves where it was filed on its board alone",
    afterFiling.x === filed.x && afterFiling.y === filed.y && afterFiling.pageId === onBoard.pageId,
    `${afterFiling.x},${afterFiling.y} on ${afterFiling.pageId}, filed at ${filed.x},${filed.y}`);
  Object.assign(onBoard, filed);
  await reachFor(web, { x: rest.vw - 30, y: rest.vh - 30 });
  await web.click(rest.vw - 30, rest.vh - 30);
  await fitted();

  /* ------------------------------------------------------------ reminders */

  await front(web);
  const reach = await onPage(`${NOTE} .note-body`);
  await reachFor(web, reach);
  await expanded();
  const remind = await rectIn(`${NOTE} .note-remind-add`);
  const remindShown = !!remind && remind.width > 0;
  check("[web] its footer offers a reminder, as on the board", remindShown);
  if (remindShown) {
    await reachFor(web, { x: remind.cx, y: remind.cy });
    await web.click(remind.cx, remind.cy);
    const pickerUp = await yes(frame.waitFor(`!!document.querySelector('.remind-menu')`, { timeout: 5000 }));
    check("[web] the reminder picker opens", pickerUp);
    if (pickerUp) {
      const picker = await rectIn(".remind-menu");
      check("[web] all of it on screen, not cut off at the note's edge",
        picker.x >= 0 && picker.y >= 0 && picker.right <= picker.vw && picker.bottom <= picker.vh && picker.vw === rest.vw,
        JSON.stringify(picker));
      const first = await rectIn(".remind-menu .remind-item");
      await web.click(first.cx, first.cy);
      const reminded = await until(async () => (await recordOf(board, "afloat")).remindAt);
      check("[web] and a reminder set there is set on the note", !!reminded);
      check("[web] which the board shows, with no reload",
        await yes(board.waitFor(`!document.querySelector('[data-id="afloat"] .note-remind').hidden`, { timeout: 5000 })));
      // Setting it used to throw halfway, in code that marks the board's page
      // tree — which a frame does not have — so the picker stayed open and the
      // chip that clears it was never shown.
      check("[web] the picker closes once a time is picked",
        await yes(frame.waitFor(`!document.querySelector('.remind-menu')`, { timeout: 3000 })));
      check("[web] and the note shows the reminder, where it can be cleared",
        await yes(frame.waitFor(`!document.querySelector('${NOTE} .note-remind').hidden`, { timeout: 3000 })));

      await reachFor(web, { x: rest.vw - 30, y: rest.vh - 30 });
      await fitted();
      const chip = await rectIn(`${NOTE} .note-remind`);
      if (chip && chip.width) {
        await reachFor(web, { x: chip.cx, y: chip.cy });
        await web.click(chip.cx, chip.cy);
      }
      const cleared = await until(async () => !(await recordOf(board, "afloat")).remindAt);
      check("[web] clicking the reminder clears it", !!cleared, chip ? JSON.stringify(chip) : "no chip");
      check("[web] on the board too, with no reload",
        await yes(board.waitFor(`document.querySelector('[data-id="afloat"] .note-remind').hidden`, { timeout: 5000 })));
    }
  }

  /* ----------------------------------------------------------------- menu */

  await reachFor(web, { x: rest.vw - 30, y: rest.vh - 30 });
  await fitted();
  const body = await onPage(`${NOTE} .note-body`);
  await reachFor(web, body);
  await expanded();
  await web.click(body.x, body.y, 1, { button: "right", buttons: 2 });
  const menuUp = await yes(frame.waitFor(`!!document.querySelector('.ctx-menu')`, { timeout: 5000 }));
  check("[web] right-clicking it opens the note's own menu", menuUp);
  if (menuUp) {
    const labels = await frame.evaluate(`[...document.querySelectorAll('.ctx-item')].map((b) => b.textContent)`);
    check("[web] with everything a note's menu has", labels.includes("Delete note") && labels.includes("Fullscreen"),
      labels.join(", "));
    check("[web] and the way back down, first of all", labels[0] === "Unfloat", labels.join(", "));
    check("[web] with no copy on a page with no other board to copy onto",
      !labels.includes("Copy note"), labels.join(", "));
    check("[web] but nothing that only means something on a board",
      !labels.includes("Float") && !labels.some((l) => l.startsWith("Put these")), labels.join(", "));
    const menu = await rectIn(".ctx-menu");
    check("[web] the menu is on screen", menu.x >= 0 && menu.y >= 0 && menu.right <= menu.vw && menu.bottom <= menu.vh);
    await web.key("Escape", "Escape");
    await web.settle(200);
    check("[web] Escape closes the menu and leaves the note floating",
      !(await frame.evaluate(`!!document.querySelector('.ctx-menu')`)) && (await recordOf(board, "afloat")).floating === true);
  }

  /* -------------------------------------------------------------- moving */

  await reachFor(web, { x: rest.vw - 30, y: rest.vh - 30 });
  await web.click(rest.vw - 30, rest.vh - 30);
  await fitted();
  const grab = await onPage(`${NOTE} .note-body`);
  await reachFor(web, grab);
  await expanded();
  await web.drag(grab.x, grab.y, -150, 90);
  const put = await until(async () => {
    const n = await recordOf(board, "afloat");
    return n.floatingGeometry ? n : null;
  });
  const landed = await onPage(`${NOTE} .note-body`);
  check("[web] dragging it on the page moves it there",
    !!landed && Math.abs(landed.x - (grab.x - 150)) <= 4 && Math.abs(landed.y - (grab.y + 90)) <= 4,
    landed && `${Math.round(landed.x)},${Math.round(landed.y)} from ${Math.round(grab.x)},${Math.round(grab.y)}`);
  check("[web] and where it floats is kept, in the page's own pixels",
    !!put && Math.abs(put.floatingGeometry.x - (cardAtRest.x - 150)) <= 4, put && JSON.stringify(put.floatingGeometry));
  check("[web] while its place on the board is its own, untouched",
    !!put && put.x === onBoard.x && put.y === onBoard.y && put.width === onBoard.width, put && `${put.x},${put.y}`);

  /* ------------------------------------- floated while the page is open */

  await front(board);

  // Registering the script only reaches pages loaded afterwards, so a page that
  // is already open has to be sent the note. And an app floats as what it is.
  await board.seed("notes", [{
    id: "afloat-timer", app: "timer", x: 760, y: 240, width: 220, height: 150, html: "",
    color: "transparent", z: 2, createdAt: now, editedAt: now, updatedAt: Date.now(),
  }]);
  await noteMenu(board, "afloat-timer");
  await pick(board, "Float");
  await front(web);
  const second = await yes(web.waitFor(`!!${FRAME("afloat-timer")}`, { timeout: 10000 }));
  check("[web] a note floated while the page is open arrives on it, with no reload", second);
  if (second) {
    const timer = await browser.frame("float.html?id=afloat-timer");
    await focused(timer);
    check("[web] an app floats too, drawn by the app's own code",
      await yes(timer.waitFor(`(() => { const b = document.querySelector('.note-body.is-app'); return !!b && /\\d:\\d\\d/.test(b.textContent); })()`, { timeout: 8000 })));
  }

  /* ---------------------------------------------- a command, on the page */

  await front(web);
  const typeAt = await onPage(`${NOTE} .note-body p`);
  await reachFor(web, typeAt);
  await expanded();
  await web.click(typeAt.x, typeAt.y);
  await yes(frame.waitFor(`!!document.querySelector('${NOTE} .ProseMirror')`, { timeout: 5000 }));
  const framesBefore = await web.evaluate(`document.querySelectorAll('iframe').length`);
  await web.typeKeys(" /timer");
  await yes(frame.waitFor(`!!document.querySelector('.slash-item')`, { timeout: 3000 }));
  await web.key("Enter", "Enter");
  const madeTimer = await until(async () =>
    (await board.stored("notes")).find((n) => n.app === "timer" && n.id !== "afloat-timer" && !n.deleted)
  );
  const source = await recordOf(board, "afloat");
  check("[web] a command typed in a floating note makes its note", !!madeTimer);
  check("[web] and that note floats too", !!madeTimer && madeTimer.floating === true);
  check("[web] beside the one it came from, top edges level",
    !!madeTimer && !!madeTimer.floatingGeometry && !!source.floatingGeometry &&
      madeTimer.floatingGeometry.y === source.floatingGeometry.y &&
      (madeTimer.floatingGeometry.x >= source.floatingGeometry.x + source.floatingGeometry.width ||
        madeTimer.floatingGeometry.x + madeTimer.floatingGeometry.width <= source.floatingGeometry.x),
    madeTimer && JSON.stringify({ made: madeTimer.floatingGeometry, from: source.floatingGeometry }));
  check("[web] waiting in the Capture tray, like anything else made out on a webpage",
    !!madeTimer && madeTimer.pageId === "capture-tray", madeTimer && madeTimer.pageId);
  check("[web] where the board shows it, with no reload",
    await yes(board.waitFor(`document.querySelectorAll('#tray-items .tray-item').length > 0`, { timeout: 8000 })));
  check("[web] and it arrives on the page, in a frame of its own",
    await yes(web.waitFor(`document.querySelectorAll('iframe').length === ${framesBefore + 1}`, { timeout: 8000 })));
  await reachFor(web, { x: rest.vw - 30, y: rest.vh - 30 });
  await web.click(rest.vw - 30, rest.vh - 30);
  await fitted();

  /* ------------------------------------------------------ tucked away */

  // Escape on a webpage does not take a note off the page: it tucks it to the
  // nearer edge, a sliver left showing, still floating. Unfloat is in its menu.
  await front(web);
  // Pointed at from inside the page, so the steps never leave the viewport.
  const pointAt = async ({ x, y }) => {
    for (let i = 5; i >= 0; i--) {
      await web.move(x + (x < rest.vw / 2 ? i * 6 : -i * 6), y - i * 2);
      await sleep(20);
    }
  };
  // The middle of its tab: the top of the note, which is all of it that shows.
  const tipOf = (r) => ({ x: r.x < 0 ? Math.max(4, r.right - 6) : Math.min(r.vw - 4, r.x + 6), y: r.y + 36 });
  const openIt = async () => {
    const at = await onPage(`${NOTE} .note-body`);
    await reachFor(web, at);
    await expanded();
    await web.click(at.x, at.y);
    return yes(frame.waitFor(`!!document.querySelector('${NOTE} .ProseMirror')`, { timeout: 5000 }));
  };

  await openIt();
  const homeBox = (await recordOf(board, "afloat")).floatingGeometry;
  await web.evaluate(`(() => { window.__pageClicks = 0; document.addEventListener('click', () => window.__pageClicks++, true); return true; })()`);
  await web.key("Escape", "Escape");
  // A click on the page while the note is still on its way to the edge. It is
  // the page's click, and it used to bring the note straight back.
  await web.pause(120);
  await reachFor(web, { x: rest.vw - 40, y: rest.vh - 40 });
  await web.click(rest.vw - 40, rest.vh - 40);
  const tucked = await until(async () => (await recordOf(board, "afloat")).floatingTucked);
  const stillUp = await recordOf(board, "afloat");
  check("[web] Escape on the page tucks the note away", !!tucked);
  await web.pause(500);
  check("[web] and a click on the page while it slides leaves it tucked", !!(await recordOf(board, "afloat")).floatingTucked);
  const pageClicks = await web.evaluate(`window.__pageClicks`);
  check("[web] that click is the page's", pageClicks >= 1, `${pageClicks} clicks`);
  check("[web] and does not take it off the page: it is still floating",
    stillUp.floating === true && (await web.evaluate(`!!${FRAME("afloat")}`)));
  check("[web] nor forget where it was",
    JSON.stringify(stillUp.floatingGeometry) === JSON.stringify(homeBox), JSON.stringify(stillUp.floatingGeometry));

  await reachFor(web, { x: rest.vw / 2, y: rest.vh - 30 });
  await fitted();
  await web.pause(500); // the slide itself
  const sliver = await rectIn(NOTE);
  const showing = Math.min(sliver.right, sliver.vw - sliver.x);
  check("[web] it slides to the edge of the page, a sliver left showing",
    showing >= 8 && showing <= 24, `${Math.round(showing)}px showing`);
  const [ct, cr, cb, cl] = ((await frameBox()).clip.match(/-?[\d.]+px/g) || []).map(parseFloat);
  check("[web] and the page keeps every click but the sliver's", cr - cl <= 70 && cb - ct <= 100, `${cl}..${cr} x ${ct}..${cb}`);
  // The tab is cut out of the note, which cuts its own shadow away too; on a
  // page the colour of the note it vanished.
  const tabLook = await frame.evaluate(`getComputedStyle(document.getElementById('float-root')).filter`);
  check("[web] the tab keeps a shadow of its own, so it shows on any page", /drop-shadow/.test(tabLook), tabLook);

  const tip = tipOf(sliver);
  await pointAt(tip);
  await expanded();
  await web.pause(450);
  const leaning = await rectIn(NOTE);
  check("[web] reaching for the sliver draws the note out a little, as a hint",
    Math.abs(leaning.x - sliver.x) >= 3, `${Math.round(sliver.x)} -> ${Math.round(leaning.x)}`);
  await web.pause(400);
  const stillLeaning = await rectIn(NOTE);
  check("[web] a peek that stays put while it is reached for, not a swing",
    Math.abs(stillLeaning.x - leaning.x) <= 1, `${Math.round(leaning.x)} then ${Math.round(stillLeaning.x)}`);
  check("[web] and says what a click will do", (await frame.evaluate(`document.querySelector('${NOTE}').title`)).length > 0);

  await web.click(tip.x, tip.y);
  const back = await until(async () => !(await recordOf(board, "afloat")).floatingTucked);
  await web.pause(550);
  const home = await rectIn(NOTE);
  check("[web] clicking the sliver brings the note back", !!back);
  check("[web] to where it was on the page",
    Math.abs(home.x - homeBox.x) <= 2 && Math.abs(home.y - homeBox.y) <= 2,
    `${Math.round(home.x)},${Math.round(home.y)} was ${homeBox.x},${homeBox.y}`);
  check("[web] only brought back, not opened for writing",
    !(await frame.evaluate(`!!document.querySelector('${NOTE} .ProseMirror')`)));

  /* ---------------------------------------------- held: every note tucked */

  await openIt();
  const escape = { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 };
  await web.cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...escape });
  await web.pause(800);
  await web.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...escape });
  const everyone = await until(async () => {
    const afloat = (await board.stored("notes")).filter((n) => n.floating && !n.deleted);
    return afloat.length >= 2 && afloat.every((n) => n.floatingTucked) ? afloat : null;
  });
  check("[web] holding Escape tucks away every floating note, not only this one", !!everyone,
    JSON.stringify((await board.stored("notes")).filter((n) => n.floating).map((n) => [n.id.slice(0, 8), !!n.floatingTucked])));
  const tabs = (await board.stored("notes")).filter((n) => n.floating && n.floatingTucked).map((n) => n.floatingTucked);
  const clash = tabs.some((a, i) => tabs.some((b, j) => i < j && a.side === b.side && Math.abs(a.y - b.y) < 72));
  check("[web] each with a tab of its own at the edge, none on top of another", tabs.length >= 2 && !clash, JSON.stringify(tabs));
  const otherFrame = await browser.frame("float.html?id=afloat-timer").catch(() => null);
  check("[web] and their frames take it in, with no reload",
    !!otherFrame && (await yes(otherFrame.waitFor(`!!document.querySelector('.note.is-tucked')`, { timeout: 5000 }))));

  /* ------------------------------------- held again: a toggle, not a ratchet */

  await web.cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...escape });
  await web.pause(800);
  await web.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...escape });
  const backOut = await until(async () => {
    const afloat = (await board.stored("notes")).filter((n) => n.floating && !n.deleted);
    return afloat.length >= 2 && afloat.every((n) => !n.floatingTucked) ? afloat : null;
  });
  check("[web] and held again with all of them tucked, it is the way back out",
    !!backOut,
    JSON.stringify((await board.stored("notes")).filter((n) => n.floating).map((n) => [n.id.slice(0, 8), !!n.floatingTucked])));

  // Put them back the way the next section finds them: tucked, same as
  // holding Escape a third time would.
  await web.cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...escape });
  await web.pause(800);
  await web.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...escape });
  await until(async () => {
    const afloat = (await board.stored("notes")).filter((n) => n.floating && !n.deleted);
    return afloat.length >= 2 && afloat.every((n) => n.floatingTucked) ? afloat : null;
  });

  /* ------------------------------------------------ Unfloat, from the menu */

  await reachFor(web, { x: rest.vw / 2, y: rest.vh - 30 });
  await web.pause(500);
  const tipAgain = tipOf(await rectIn(NOTE));
  await pointAt(tipAgain);
  await web.click(tipAgain.x, tipAgain.y);
  await until(async () => !(await recordOf(board, "afloat")).floatingTucked);
  await web.pause(550);
  const menuAt = await onPage(`${NOTE} .note-body`);
  await reachFor(web, menuAt);
  await expanded();
  await web.click(menuAt.x, menuAt.y, 1, { button: "right", buttons: 2 });
  await yes(frame.waitFor(`!!document.querySelector('.ctx-menu')`, { timeout: 5000 }));
  const unfloatAt = await frame.evaluate(`(() => {
    const b = [...document.querySelectorAll('.ctx-item')].find((i) => i.textContent === 'Unfloat');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (unfloatAt) {
    await reachFor(web, unfloatAt);
    await web.click(unfloatAt.x, unfloatAt.y);
  }
  const down = await until(async () => {
    const n = await recordOf(board, "afloat");
    return n && !n.floating ? n : null;
  });
  check("[web] Unfloat in its menu takes it off the page", !!down);
  check("[web] and its frame leaves the page", await yes(web.waitFor(`!${FRAME("afloat")}`, { timeout: 5000 })));
  check("[web] the board takes its mark off, with no reload",
    await yes(board.waitFor(`!document.querySelector('[data-id="afloat"]').classList.contains('is-floating')`, { timeout: 5000 })));
  check("[web] and it is on the board where it always was", !!down && down.x === onBoard.x && down.y === onBoard.y);
  await web.close();

  /* ----------------------------------------------- framed by anyone else */

  // Last, because it opens a window of its own, and a window opening takes the
  // keyboard with it.

  const open = await browser.open(`${site}open`, { newWindow: true });
  await yes(open.waitFor(`document.querySelectorAll('iframe').length > 0`, { timeout: 15000 }));
  await open.evaluate(`(() => {
    const real = document.querySelector('iframe');
    const forged = document.createElement('iframe');
    // The right address, which the page can read straight off our own frame.
    forged.src = real.src.replace(/id=[^&]+/, 'id=afloat') + '&forged=1';
    forged.addEventListener('load', () => {
      const channel = new MessageChannel();
      forged.contentWindow.postMessage({ type: 'easynote:float-hello', token: 'a guess',
        box: { x: 0, y: 0, width: 300, height: 200 }, frame: { x: 0, y: 0, width: 320, height: 220 },
        viewport: { width: 1200, height: 800 } }, '*', [channel.port2]);
    });
    document.body.appendChild(forged);
    return true;
  })()`);
  const forged = await browser.frame("forged=1").catch(() => null);
  if (forged) await open.pause(1500);
  check("[web] a page that frames the note itself, at the right address and with a guess at the token, is shown nothing",
    !!forged && (await forged.evaluate(`!document.querySelector('.note')`)), forged ? "" : "the forged frame never loaded");
  await open.close();
}
