#!/usr/bin/env node
//
//   npm run screenshots  ->  store/screenshot-*.png
//
// Builds the five Chrome Web Store screenshots from the real extension, at the
// 1280x800 the store asks for. Shot rather than mocked up, so the listing can
// never drift from what the app actually looks like — the last set went stale
// across two releases before anyone noticed.
//
// The clipper shot needs a real web page to clip from, so one is served on
// localhost for the length of the run. It is deliberately fictional: a store
// screenshot must not put words in a real publication's mouth.

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { launch } from "../test/ui/harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "store");
const W = 1280, H = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ARTICLE = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>The Cost of Context Switching — Field Notes</title>
<style>
  body { margin: 0; font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #23211d; background: #fff; }
  header { border-bottom: 1px solid #e8e4dc; padding: 18px 0; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 0 28px; }
  .brand { font-weight: 700; letter-spacing: -0.01em; }
  .brand span { color: #9a9389; font-weight: 400; margin-left: 10px; }
  h1 { font-size: 34px; line-height: 1.18; letter-spacing: -0.02em; margin: 34px 0 10px; }
  .meta { color: #9a9389; font-size: 14px; margin-bottom: 26px; }
  figure { margin: 26px 0; }
  .chart { border: 1px solid #e8e4dc; border-radius: 4px; padding: 20px 22px 14px; background: #fbfaf8; }
  .chart h3 { margin: 0 0 16px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.07em; color: #7a736a; }
  .bar { display: grid; grid-template-columns: 116px 1fr 52px; align-items: center; gap: 12px; margin-bottom: 9px; font-size: 13px; }
  .bar i { font-style: normal; color: #55504a; }
  .bar u { display: block; height: 15px; border-radius: 2px; text-decoration: none; }
  .bar b { text-align: right; color: #7a736a; font-weight: 500; }
  figcaption { font-size: 13px; color: #9a9389; margin-top: 9px; }
  p { margin: 0 0 18px; }
</style></head>
<body>
  <header><div class="wrap brand">Field Notes <span>Research letter · No. 41</span></div></header>
  <div class="wrap">
    <h1>The real cost of a context switch</h1>
    <div class="meta">A small study of interrupted work · 8 min read</div>
    <p>Every tab you open to save something is a decision you have to unmake later. We asked 214 people to log the moment they broke off from a task, and what pulled them away.</p>
    <figure>
      <div class="chart">
        <h3>Minutes lost per interruption</h3>
        <div class="bar"><i>Opening a tab</i><u style="width:38%;background:#8fb4e8"></u><b>4.2</b></div>
        <div class="bar"><i>Finding it again</i><u style="width:71%;background:#7aa5e0"></u><b>7.8</b></div>
        <div class="bar"><i>Re-reading it</i><u style="width:52%;background:#a9c8ef"></u><b>5.7</b></div>
        <div class="bar"><i>Getting back in</i><u style="width:94%;background:#5f90d6"></u><b>10.3</b></div>
      </div>
      <figcaption>Self-reported, n=214. Getting back into the work costs more than the interruption itself.</figcaption>
    </figure>
    <p>The pattern held across every group we looked at: the interruption is cheap and the return is expensive. Anything that shortens the return is worth more than anything that prevents the interruption.</p>
  </div>
</body></html>
`;

const server = http.createServer((_, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(ARTICLE);
});
await new Promise((r) => server.listen(8731, r));

const overlaySrc = fs.readFileSync(path.join(root, "js/clip/overlay.js"), "utf8");
const browser = await launch({ port: 9600 });

async function frame(page) {
  await page.cdp.send("Emulation.setDeviceMetricsOverride", {
    width: W, height: H, deviceScaleFactor: 1, mobile: false,
  });
  await sleep(200);
}

async function shoot(page, name) {
  await sleep(400);
  const shot = await page.cdp.send("Page.captureScreenshot", {
    format: "png", clip: { x: 0, y: 0, width: W, height: H, scale: 1 },
  });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(shot.data, "base64"));
  console.log("  wrote", name);
}

const note = (o) => ({
  width: 240, height: 150, color: "transparent", z: 1, locked: false,
  createdAt: Date.now(), editedAt: Date.now(), updatedAt: Date.now(), ...o,
});

/* ------------------------------------------------------------- the board */

const page = await browser.page();
await frame(page);
await page.reset();
await frame(page);

const pages = [
  { id: "p-work", name: "Work", parentId: null, order: 0, collapsed: false },
  { id: "p-res", name: "Research", parentId: null, order: 1, collapsed: false },
  { id: "p-int", name: "Interviews", parentId: "p-res", order: 0, collapsed: false },
  { id: "p-home", name: "Personal", parentId: null, order: 2, collapsed: false },
];
await page.evaluate(`new Promise((resolve) => {
  const open = indexedDB.open('easynote');
  open.onsuccess = () => {
    const tx = open.result.transaction(['pages','meta'], 'readwrite');
    ${JSON.stringify(pages)}.forEach((p) => tx.objectStore('pages').put({ ...p, updatedAt: Date.now() }));
    tx.objectStore('meta').put({ id: 'currentPage', pageId: 'p-work' });
    // Tombstone the page reset() created; the tree in these shots is ours.
    const all = tx.objectStore('pages').getAll();
    all.onsuccess = () => all.result
      .filter((p) => !p.id.startsWith('p-') && p.id !== 'capture-tray')
      .forEach((p) => tx.objectStore('pages').put({ ...p, deleted: true, deletedAt: Date.now(), updatedAt: Date.now() }));
    // No "what's new" pill and no tips in a screenshot.
    tx.objectStore('meta').put({ id: 'seenVersion', version: chrome.runtime.getManifest().version });
    tx.objectStore('meta').put({ id: 'prefs', lastTipAt: Date.now() });
    tx.oncomplete = () => resolve(true);
  };
})`);

const board = [
  // Three rows, so the frame is filled rather than a cluster at the top with
  // half the board empty underneath it.
  note({ id: "n1", x: 40, y: 30, width: 268, height: 172, color: "#fff6a3", pageId: "p-work",
    html: "<h2>Ship 3.2</h2><ul data-type=\"taskList\"><li data-checked=\"true\" data-type=\"taskItem\"><label><input type=\"checkbox\" checked=\"checked\"></label><div><p>Store listing</p></div></li><li data-checked=\"false\" data-type=\"taskItem\"><label><input type=\"checkbox\"></label><div><p>Screenshots</p></div></li><li data-checked=\"false\" data-type=\"taskItem\"><label><input type=\"checkbox\"></label><div><p>Submit for review</p></div></li></ul>" }),
  note({ id: "n2", x: 348, y: 30, width: 254, height: 104, pageId: "p-work",
    html: "<p>Anything that shortens <em>the return</em> is worth more than anything that prevents the interruption.</p>" }),
  note({ id: "n3", x: 642, y: 30, width: 246, height: 104, color: "#ffd6d6", pageId: "p-work", remindAt: Date.now() + 90 * 60000,
    html: "<h2>Call Dana back</h2><p>Before Friday.</p>" }),

  note({ id: "n5", x: 348, y: 166, width: 254, height: 172, color: "#d6e8ff", pageId: "p-work",
    html: "<h2>Reading list</h2><ul><li><p>Context switching study</p></li><li><p>Flameshot's capture flow</p></li><li><p>Spring-loaded folders</p></li></ul>" }),
  note({ id: "n6", x: 642, y: 166, width: 246, height: 118, color: "#e6d6ff", pageId: "p-work",
    html: "<p>Ideas are cheap. Writing them down before they go is the whole trick.</p>" }),
  note({ id: "n4", x: 40, y: 234, width: 268, height: 118, color: "#d6f5d6", pageId: "p-work",
    html: "<p>Double-click anywhere and start typing. That is the whole thing.</p>" }),

  note({ id: "n9", x: 40, y: 384, width: 268, height: 132, color: "#d3f2f0", pageId: "p-work",
    html: "<h2>Standup</h2><p>Clipper is in. Tray next — then the store.</p>" }),
  note({ id: "n10", x: 348, y: 370, width: 254, height: 146, pageId: "p-work",
    html: "<p>Ask about the 214-person sample — was it self-selected?</p><p>Worth a footnote either way.</p>" }),
  note({ id: "n11", x: 642, y: 316, width: 246, height: 200, color: "#ffe0bd", pageId: "p-work", locked: true,
    html: "<h2>Wifi</h2><p>guest / hunter2</p><p>Locked so it survives a tidy-up.</p>" }),

  note({ id: "n12", x: 40, y: 528, width: 268, height: 124, color: "#ffe680", pageId: "p-work",
    html: "<p>⌥⇧S on any page — drag a box, it lands in the tray.</p>" }),
  note({ id: "n13", x: 348, y: 528, width: 254, height: 124, pageId: "p-work",
    html: "<p>Hold a note over a page in the sidebar — that page opens underneath it.</p>" }),
  note({ id: "n14", x: 642, y: 528, width: 246, height: 96, color: "#a9cdf5", pageId: "p-work",
    html: "<p>Hold 🏠 to set where a page opens.</p>" }),
  note({ id: "n7", x: 60, y: 60, width: 240, height: 120, pageId: "p-res", remindAt: Date.now() - 600000,
    html: "<p>Chase the survey numbers — context switching cost, by role</p>" }),
  note({ id: "n8", x: 330, y: 60, width: 240, height: 120, pageId: "p-res", remindAt: Date.now() - 300000,
    html: "<p>Write up interview 04</p>" }),
  note({ id: "n15", x: 60, y: 220, width: 260, height: 120, pageId: "p-int",
    html: "<p>P07: \"the context is gone by the time I find the tab again\"</p>" }),
  note({ id: "n16", x: 60, y: 60, width: 240, height: 110, pageId: "p-home",
    html: "<p>Renew the parking permit</p>" }),
];
await page.seed("notes", board);
await frame(page);
const VIEW = `import('./js/view.js').then(m => m.setView({ x: 34, y: 24, zoom: 1 }))`;
await page.evaluate(VIEW);
await sleep(600);
await shoot(page, "screenshot-1-canvas.png");

/* --------------------------------------------------------- the dark board */

await page.evaluate(`import('./js/theme.js').then(m => m.applyTheme('dark'))`);
await page.evaluate(VIEW);
await sleep(500);
await shoot(page, "screenshot-4-dark.png");
await page.evaluate(`import('./js/theme.js').then(m => m.applyTheme('light'))`);
await sleep(400);

/* ----------------------------------------------------------- the clipper */

const web = await browser.page();
await web.cdp.send("Page.navigate", { url: "http://localhost:8731/" });
await sleep(1400);
await frame(web);
await sleep(500);
await web.evaluate(overlaySrc);
await sleep(300);

// Drag a box round the chart, and stop on the toolbar that follows.
const box = await web.evaluate(`(() => {
  const r = document.querySelector('.chart').getBoundingClientRect();
  return { x: Math.round(r.left - 10), y: Math.round(r.top - 10),
           x2: Math.round(r.right + 10), y2: Math.round(r.bottom + 10) };
})()`);
await web.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", buttons: 1, clickCount: 1 });
for (let i = 1; i <= 10; i++) {
  await web.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1,
    x: box.x + ((box.x2 - box.x) * i) / 10, y: box.y + ((box.y2 - box.y) * i) / 10 });
  await sleep(30);
}
await sleep(250);
await shoot(web, "screenshot-2-clip.png"); // mid-drag, with the live size readout
await web.close();

/* --------------------------------------------------------------- the tray */

const clip = (id, title, colour, ago) => ({
  ...note({ id, x: 0, y: 0, width: 224, height: 200, pageId: "capture-tray",
    html: `<img data-img-id="img-${id}"><p><a href="https://example.com/${id}">${title}</a></p>` }),
  createdAt: Date.now() - ago, editedAt: Date.now() - ago, updatedAt: Date.now() - ago,
  __colour: colour,
});
const clips = [
  clip("c1", "The real cost of a context switch — Field Notes", "#8fb4e8", 0),
  clip("c2", "Pricing page — Q3 comparison", "#e8c07a", 3600000),
  clip("c3", "Release checklist template", "#8fd9a8", 3 * 86400000),
  clip("c4", "Colour tokens, dark variants", "#c9a8e8", 9 * 86400000),
];
await page.evaluate(`(async () => {
  const put = (store, value) => new Promise((res) => {
    const open = indexedDB.open('easynote');
    open.onsuccess = () => {
      const tx = open.result.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => res(true);
    };
  });
  await put('pages', { id: 'capture-tray', name: 'Captures', parentId: null, order: -1, collapsed: false, updatedAt: Date.now() });
  const shots = ${JSON.stringify(clips.map((c) => ({ id: c.id, colour: c.__colour })))};
  for (const s of shots) {
    const c = new OffscreenCanvas(440, 260);
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 440, 260);
    g.fillStyle = s.colour; g.globalAlpha = 0.22; g.fillRect(0, 0, 440, 260); g.globalAlpha = 1;
    g.fillStyle = s.colour;
    for (let i = 0; i < 4; i++) g.fillRect(28, 40 + i * 44, 90 + i * 78, 22);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(28, 16, 150, 10);
    const blob = await c.convertToBlob({ type: 'image/png' });
    await put('images', { id: 'img-' + s.id, blob });
  }
  return true;
})()`);
await page.seed("notes", [...board, ...clips.map(({ __colour, ...c }) => c)]);
await frame(page);
await page.evaluate(VIEW);
await sleep(900);
await shoot(page, "screenshot-3-tray.png");

/* -------------------------------------------------------------- search */

await page.evaluate(`import('./js/search.js').then(m => m.open())`);
await sleep(400);
await page.evaluate(`(() => {
  const input = document.getElementById('search-input');
  input.value = 'context';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await sleep(800);
await shoot(page, "screenshot-5-search.png");

await browser.close();
server.close();
console.log("done");
