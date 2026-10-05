#!/usr/bin/env node
//
//   npm run video  ->  store/demo.mp4
//
// A ninety-second tour of the extension, shot from the real thing. Same reason
// the store screenshots are shot rather than mocked up: a video assembled by
// hand goes stale the first time the app changes, and nobody notices until a
// reviewer does.
//
// How it works, since there is no ffmpeg anywhere near this repo:
//
//   1. Chrome is driven through the same harness the UI tests use, and the tour
//      below is dispatched as trusted input — real double-clicks, real drags.
//   2. Page.startScreencast streams the frames out, and they are written to a
//      temp directory with the wall-clock time each one arrived.
//   3. A second tab plays those frames back on a canvas in real time and
//      records the canvas with MediaRecorder, which is the only h264 encoder
//      we have. It posts the finished file back here.
//
// The pointer does not appear in a screencast and captions are not a thing a
// browser draws, so both are DOM: a fake cursor that follows the real input
// events, and a caption bar. They are injected into whichever page is on
// camera and are the only part of the frame that is not the product.

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { launch, sleep } from "../test/ui/harness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(root, "store", "demo.mp4");
const W = 1280, H = 800;
const PORT = 8741;

const work = fs.mkdtempSync(path.join(os.tmpdir(), "easynote-video-"));
const frameDir = path.join(work, "frames");
fs.mkdirSync(frameDir);

/* ------------------------------------------------------------------ pieces */

const overlaySrc = fs.readFileSync(path.join(root, "js/clip/overlay.js"), "utf8");

// The page the clipper scene clips from. Fictional on purpose — a promo video
// must not put words in a real publication's mouth or show anybody's screen.
const ARTICLE = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>The Cost of Context Switching — Field Notes</title>
<style>
  body { margin: 0; font: 16px/1.65 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; color: #23211d; background: #fff; }
  header { border-bottom: 1px solid #e8e4dc; padding: 18px 0; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 0 28px; }
  .brand { font-weight: 700; letter-spacing: -0.01em; }
  .brand span { color: #9a9389; font-weight: 400; margin-left: 10px; }
  h1 { font-size: 34px; line-height: 1.18; letter-spacing: -0.02em; margin: 34px 0 10px; }
  .meta { color: #9a9389; font-size: 14px; margin-bottom: 26px; }
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
</body></html>`;

/* ------------------------------------------------- the furniture on camera */

const FURNITURE = fs.readFileSync(path.join(root, "scripts/video-furniture.js"), "utf8");

/* -------------------------------------------------------------- the server */

/** @type {{n: number, t: number}[]} */
const frames = [];
let saved = null;
const savedAt = new Promise((resolve) => (saved = resolve));

const ENCODER = `<!doctype html><meta charset="utf-8"><title>encoding</title>
<style>body{margin:0;background:#111;color:#ddd;font:13px system-ui}canvas{width:480px;display:block}#log{padding:8px}</style>
<canvas id="c" width="${W}" height="${H}"></canvas><div id="log">starting…</div>
<script type="module">
const log = (m) => { document.getElementById('log').textContent = m; };
const list = await (await fetch('/manifest.json')).json();
const canvas = document.getElementById('c');
const g = canvas.getContext('2d', { alpha: false });

const types = ['video/mp4;codecs=avc1.4d0028', 'video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
const mime = types.find((t) => MediaRecorder.isTypeSupported(t));
if (!mime) { log('no encoder'); throw new Error('no encoder'); }

// Decoded frames are 4MB each, so only a short run-up is ever held in memory:
// playback is real time, and the fetch is from localhost.
const ready = new Map();
const inFlight = new Set();
const AHEAD = 40;
function prefetch(from) {
  for (let i = from; i < Math.min(from + AHEAD, list.length); i++) {
    if (ready.has(i) || inFlight.has(i)) continue;
    inFlight.add(i);
    fetch('/f/' + list[i].n + '.jpg')
      .then((r) => r.blob())
      .then(createImageBitmap)
      .then((b) => { ready.set(i, b); inFlight.delete(i); });
  }
}
prefetch(0);
while (ready.size < Math.min(30, list.length)) await new Promise((r) => setTimeout(r, 50));

const stream = canvas.captureStream(30);
const chunks = [];
const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

const done = new Promise((r) => (rec.onstop = r));
rec.start(1000);
const t0 = performance.now();
const total = list[list.length - 1].t;
let shown = -1;

await new Promise((finish) => {
  const tick = () => {
    const now = performance.now() - t0;
    if (now > total + 200) return finish();
    let i = shown < 0 ? 0 : shown;
    while (i + 1 < list.length && list[i + 1].t <= now) i++;
    prefetch(i);
    if (i !== shown && ready.has(i)) {
      const bmp = ready.get(i);
      g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      for (const [k, v] of ready) if (k < i) { v.close(); ready.delete(k); }
      shown = i;
      log(\`\${i + 1} / \${list.length}\`);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

rec.stop();
await done;
const blob = new Blob(chunks, { type: mime });
await fetch('/save?mime=' + encodeURIComponent(mime), { method: 'POST', body: blob });
log('saved ' + (blob.size / 1e6).toFixed(1) + ' MB');
</script>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/manifest.json") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(frames));
  }
  if (url.pathname.startsWith("/f/")) {
    const file = path.join(frameDir, path.basename(url.pathname));
    res.writeHead(200, { "content-type": "image/jpeg" });
    return res.end(fs.readFileSync(file));
  }
  if (url.pathname === "/encode.html") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(ENCODER);
  }
  if (url.pathname === "/save") {
    const parts = [];
    req.on("data", (c) => parts.push(c));
    return req.on("end", () => {
      res.writeHead(200).end("ok");
      saved({ body: Buffer.concat(parts), mime: url.searchParams.get("mime") });
    });
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(ARTICLE);
});
await new Promise((r) => server.listen(PORT, r));

/* ------------------------------------------------------------ the recorder */

const recorder = {
  t0: 0,
  n: 0,
  attached: null,
  start() {
    this.t0 = Date.now();
  },
  async attach(page) {
    if (this.attached) await this.detach();
    await page.cdp.send("Page.enable");
    const onMessage = (raw) => {
      const msg = JSON.parse(raw);
      if (msg.method !== "Page.screencastFrame") return;
      const n = this.n++;
      fs.writeFileSync(path.join(frameDir, `${n}.jpg`), Buffer.from(msg.params.data, "base64"));
      frames.push({ n, t: Date.now() - this.t0 });
      page.cdp.send("Page.screencastFrameAck", { sessionId: msg.params.sessionId }).catch(() => {});
    };
    page.cdp.ws.on("message", onMessage);
    this.attached = { page, onMessage };
    await page.cdp.send("Page.startScreencast", {
      format: "jpeg", quality: 82, maxWidth: W, maxHeight: H, everyNthFrame: 1,
    });
  },
  async detach() {
    if (!this.attached) return;
    const { page, onMessage } = this.attached;
    await page.cdp.send("Page.stopScreencast").catch(() => {});
    page.cdp.ws.off("message", onMessage);
    this.attached = null;
  },
};

/* ---------------------------------------------------------------- the shoot */

const browser = await launch({ port: 9700, flags: ["--window-size=1320,880", "--hide-scrollbars"] });

const metrics = (page) =>
  page.cdp.send("Emulation.setDeviceMetricsOverride", {
    width: W, height: H, deviceScaleFactor: 1, mobile: false,
  });

const dress = (page) => page.evaluate(FURNITURE);

const say = (page, title, sub = "") =>
  page.evaluate(`window.__demo.say(${JSON.stringify(title)}, ${JSON.stringify(sub)})`);
const card = (page, title, sub = "", icon = "") =>
  page.evaluate(`window.__demo.card(${JSON.stringify(title)}, ${JSON.stringify(sub)}, ${JSON.stringify(icon)})`);

/** A slow, eased pointer move — a real drag reads as a jump at test speed. */
const glide = async (page, from, to, { hold = 90, steps = 18 } = {}) => {
  await page.mouse("mouseMoved", from.x, from.y, { buttons: 0 });
  await sleep(50);
  await page.mouse("mousePressed", from.x, from.y);
  await sleep(hold);
  for (let i = 1; i <= steps; i++) {
    const p = i / steps;
    const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
    await page.mouse("mouseMoved", from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    await sleep(10);
  }
  await sleep(70);
  await page.mouse("mouseReleased", to.x, to.y, { buttons: 0 });
  await sleep(180);
};

/**
 * A drag that stops on a page row on the way.
 *
 * Held over a row, the sidebar springs that page open underneath the drag —
 * so the notes can be dropped onto the board they are being filed into rather
 * than onto the name of it. That pause is the whole gesture, and it is worth
 * a beat of the video.
 */
const dragVia = async (page, from, row, to, { dwell = 1200 } = {}) => {
  await page.mouse("mouseMoved", from.x, from.y, { buttons: 0 });
  await sleep(60);
  await page.mouse("mousePressed", from.x, from.y);
  await sleep(120);
  const steps = 16;
  for (let i = 1; i <= steps; i++) {
    const p = i / steps;
    const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
    await page.mouse("mouseMoved", from.x + (row.x - from.x) * e, from.y + (row.y - from.y) * e);
    await sleep(11);
  }
  // Hold, with the smallest of movement, so the row keeps seeing a pointer.
  for (let i = 0; i < Math.round(dwell / 60); i++) {
    await page.mouse("mouseMoved", row.x + (i % 2), row.y);
    await sleep(60);
  }
  for (let i = 1; i <= steps; i++) {
    const p = i / steps;
    const e = 1 - (1 - p) ** 3;
    await page.mouse("mouseMoved", row.x + (to.x - row.x) * e, row.y + (to.y - row.y) * e);
    await sleep(13);
  }
  await sleep(160);
  await page.mouse("mouseReleased", to.x, to.y, { buttons: 0 });
  await sleep(260);
};

/** Move the pointer there first, so a click is never a teleport. */
const point = async (page, x, y, ms = 170) => {
  const steps = 12;
  const at = await page.evaluate(`(() => {
    const m = /translate\\(([-\\d.]+)px, ([-\\d.]+)px\\)/.exec(document.getElementById('demo-cursor').style.transform);
    return m ? { x: +m[1], y: +m[2] } : { x: ${W / 2}, y: ${H / 2} };
  })()`);
  for (let i = 1; i <= steps; i++) {
    const p = i / steps;
    const e = 1 - (1 - p) ** 3;
    await page.mouse("mouseMoved", at.x + (x - at.x) * e, at.y + (y - at.y) * e, { buttons: 0 });
    await sleep(ms / steps);
  }
};

const clickAt = async (page, x, y, times = 1) => {
  await point(page, x, y);
  await sleep(70);
  await page.click(x, y, times);
};

const boxOf = (page, selector) =>
  page.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);

const clickOn = async (page, selector, times = 1) => {
  const at = await boxOf(page, selector);
  if (!at) throw new Error(`nothing at ${selector}`);
  await clickAt(page, at.x, at.y, times);
};

const VIEW = (v) => `import('./js/view.js').then(m => m.setView(${JSON.stringify(v)}))`;

/** Click a menu item by its label, the way a person picks it. */
const pickMenu = async (page, selector, label) => {
  const at = await page.evaluate(`(() => {
    const item = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((b) => b.textContent.trim() === ${JSON.stringify(label)});
    if (!item) return null;
    const r = item.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!at) throw new Error(`no menu item labelled ${label}`);
  await clickAt(page, at.x, at.y);
};

const note = (o) => ({
  width: 240, height: 150, color: "transparent", z: 1, locked: false,
  createdAt: Date.now(), editedAt: Date.now(), updatedAt: Date.now(), ...o,
});

/* --------------------------------------------------------------- the board */

const page = await browser.page();
await metrics(page);
await page.reset();
await metrics(page);

const pages = [
  { id: "p-scratch", name: "Today", parentId: null, order: 0, collapsed: false },
  { id: "p-work", name: "Work", parentId: null, order: 1, collapsed: false },
  { id: "p-loose", name: "Inbox", parentId: null, order: 2, collapsed: false },
  { id: "p-week", name: "This week", parentId: null, order: 3, collapsed: false },
  { id: "p-res", name: "Research", parentId: null, order: 4, collapsed: false },
  { id: "p-int", name: "Interviews", parentId: "p-res", order: 0, collapsed: false },
  { id: "p-home", name: "Personal", parentId: null, order: 5, collapsed: false },
  { id: "capture-tray", name: "Captures", parentId: null, order: -1, collapsed: false },
];

await page.evaluate(`new Promise((resolve) => {
  const open = indexedDB.open('easynote');
  open.onsuccess = () => {
    const tx = open.result.transaction(['pages','meta'], 'readwrite');
    ${JSON.stringify(pages)}.forEach((p) => tx.objectStore('pages').put({ ...p, updatedAt: Date.now() }));
    tx.objectStore('meta').put({ id: 'currentPage', pageId: 'p-scratch' });
    const all = tx.objectStore('pages').getAll();
    all.onsuccess = () => all.result
      .filter((p) => !${JSON.stringify(pages.map((p) => p.id))}.includes(p.id))
      .forEach((p) => tx.objectStore('pages').put({ ...p, deleted: true, deletedAt: Date.now(), updatedAt: Date.now() }));
    tx.objectStore('meta').put({ id: 'seenVersion', version: chrome.runtime.getManifest().version });
    tx.objectStore('meta').put({ id: 'prefs', lastTipAt: Date.now() });
    tx.oncomplete = () => resolve(true);
  };
})`);

const board = [
  note({ id: "n1", x: 40, y: 30, width: 268, height: 172, color: "#fff6a3", pageId: "p-work",
    html: `<h2>Ship 3.4</h2><ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"></label><div><p>Store listing</p></div></li><li data-checked="false" data-type="taskItem"><label><input type="checkbox"></label><div><p>Screenshots</p></div></li><li data-checked="false" data-type="taskItem"><label><input type="checkbox"></label><div><p>Submit for review</p></div></li></ul>` }),
  note({ id: "n2", x: 348, y: 30, width: 254, height: 104, pageId: "p-work",
    html: `<p>Anything that shortens <em>the return</em> is worth more than anything that prevents the interruption.</p>` }),
  note({ id: "n3", x: 642, y: 30, width: 246, height: 104, color: "#ffd6d6", pageId: "p-work", remindAt: Date.now() + 90 * 60000,
    html: `<h2>Call Dana back</h2><p>Before Friday.</p>` }),
  note({ id: "n5", x: 348, y: 166, width: 254, height: 172, color: "#d6e8ff", pageId: "p-work",
    html: `<h2>Reading list</h2><ul><li><p>Context switching study</p></li><li><p>Flameshot's capture flow</p></li><li><p>Spring-loaded folders</p></li></ul>` }),
  note({ id: "n6", x: 642, y: 166, width: 246, height: 118, color: "#e6d6ff", pageId: "p-work",
    html: `<p>Ideas are cheap. Writing them down before they go is the whole trick.</p>` }),
  note({ id: "n4", x: 40, y: 234, width: 268, height: 118, color: "#d6f5d6", pageId: "p-work",
    html: `<p>Double-click anywhere and start typing. That is the whole thing.</p>` }),
  note({ id: "n9", x: 40, y: 384, width: 268, height: 132, color: "#d3f2f0", pageId: "p-work",
    html: `<h2>Standup</h2><p>Clipper is in. Tray next — then the store.</p>` }),
  note({ id: "n11", x: 642, y: 316, width: 246, height: 152, color: "#ffe0bd", pageId: "p-work", locked: true,
    html: `<h2>Wifi</h2><p>guest / hunter2</p><p>Locked so it survives a tidy-up.</p>` }),

  // Scene 3 wants notes that are visibly out of line, and a clear top-left
  // corner for the marquee to start in.
  note({ id: "l1", x: 120, y: 96, width: 236, height: 118, color: "#fff6a3", pageId: "p-loose",
    html: `<p>Ask about the 214-person sample — was it self-selected?</p>` }),
  note({ id: "l2", x: 470, y: 190, width: 236, height: 118, color: "#d6e8ff", pageId: "p-loose",
    html: `<p>Spring-loaded folders: hold a note over a page</p>` }),
  note({ id: "l3", x: 190, y: 330, width: 236, height: 118, color: "#d6f5d6", pageId: "p-loose",
    html: `<p>Try the clipper on a long article</p>` }),
  note({ id: "l4", x: 560, y: 396, width: 236, height: 118, color: "#e6d6ff", pageId: "p-loose",
    html: `<p>Colour tokens need a dark variant</p>` }),

  // The lists scene is shot here, on a page with room to work in.
  note({ id: "w1", x: 520, y: 90, width: 230, height: 96, color: "#fff6a3", pageId: "p-week",
    html: `<p>Rewrite the onboarding copy</p>` }),
  note({ id: "w2", x: 520, y: 220, width: 230, height: 96, color: "#d6e8ff", pageId: "p-week",
    html: `<p>Chase the Drive sync bug</p>` }),
  note({ id: "w3", x: 520, y: 350, width: 230, height: 96, color: "#d6f5d6", pageId: "p-week",
    html: `<p>Book the studio for Thursday</p>` }),

  note({ id: "n7", x: 60, y: 60, width: 240, height: 120, pageId: "p-res", remindAt: Date.now() - 600000,
    html: `<p>Chase the survey numbers — context switching cost, by role</p>` }),
  note({ id: "n15", x: 60, y: 220, width: 260, height: 120, pageId: "p-int",
    html: `<p>P07: "the context is gone by the time I find the tab again"</p>` }),
  note({ id: "n16", x: 60, y: 60, width: 240, height: 110, pageId: "p-home",
    html: `<p>Renew the parking permit</p>` }),
];

/* Pictures: a terminal screenshot with words worth copying out, and two more
   so the gallery reads as a reel. All drawn here — no real screens. */
await page.evaluate(`(async () => {
  const put = (store, value) => new Promise((res) => {
    const open = indexedDB.open('easynote');
    open.onsuccess = () => {
      const tx = open.result.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => res(true);
    };
  });

  const term = new OffscreenCanvas(1120, 700);
  const t = term.getContext('2d');
  t.fillStyle = '#1c1b19'; t.fillRect(0, 0, 1120, 700);
  t.font = '30px Menlo, monospace';
  [['#8fd9a8', '$ npm run deploy'],
   ['#e8a184', 'x build failed in 4.2s'],
   ['#efece6', ''],
   ['#efece6', 'Error: Cannot find module ./theme'],
   ['#b5aea4', '    at loadConfig (build.js:42:11)'],
   ['#b5aea4', '    at deploy (deploy.js:11:3)'],
   ['#efece6', ''],
   ['#8fb4e8', 'Run with --verbose for the full trace']].forEach(([colour, text], i) => {
    t.fillStyle = colour;
    t.fillText(text, 56, 92 + i * 58);
  });
  await put('images', { id: 'img-shot', blob: await term.convertToBlob({ type: 'image/png' }) });

  const plate = async (id, a, b) => {
    const c = new OffscreenCanvas(900, 620);
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 900, 620);
    grd.addColorStop(0, a); grd.addColorStop(1, b);
    g.fillStyle = grd; g.fillRect(0, 0, 900, 620);
    await put('images', { id, blob: await c.convertToBlob({ type: 'image/png' }) });
  };
  await plate('img-p2', '#e8c07a', '#c9a8e8');
  await plate('img-p3', '#8fd9a8', '#8fb4e8');

  // The first clip is the one the video opens in the gallery, so it has to
  // carry words a recogniser can actually read — the others are just texture.
  const clipped = new OffscreenCanvas(1000, 560);
  const c1 = clipped.getContext('2d');
  c1.fillStyle = '#ffffff'; c1.fillRect(0, 0, 1000, 560);
  c1.fillStyle = '#111111';
  c1.font = '600 38px Helvetica';
  c1.fillText('Minutes lost per interruption', 60, 86);
  c1.font = '32px Helvetica';
  [['Opening a tab', 0.30, '4.2'], ['Finding it again', 0.58, '7.8'],
   ['Re-reading it', 0.42, '5.7'], ['Getting back in', 0.78, '10.3']].forEach(([label, w, value], i) => {
    const y = 176 + i * 88;
    c1.fillStyle = '#111111';
    c1.fillText(label, 60, y + 26);
    c1.fillStyle = '#5f90d6';
    c1.fillRect(420, y, 420 * w, 34);
    c1.fillStyle = '#111111';
    c1.fillText(value, 880, y + 28);
  });
  await put('images', { id: 'img-c1', blob: await clipped.convertToBlob({ type: 'image/png' }) });

  const shots = [['c2', '#e8c07a'], ['c3', '#8fd9a8'], ['c4', '#c9a8e8']];
  for (const [id, colour] of shots) {
    const c = new OffscreenCanvas(440, 260);
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 440, 260);
    g.fillStyle = colour; g.globalAlpha = 0.22; g.fillRect(0, 0, 440, 260); g.globalAlpha = 1;
    g.fillStyle = colour;
    for (let i = 0; i < 4; i++) g.fillRect(28, 40 + i * 44, 90 + i * 78, 22);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(28, 16, 150, 10);
    await put('images', { id: 'img-' + id, blob: await c.convertToBlob({ type: 'image/png' }) });
  }
  return true;
})()`);

const pictures = [
  note({ id: "g1", x: 930, y: 30, width: 250, height: 200, pageId: "p-work",
    html: `<p>Build fell over on deploy</p><img data-img-id="img-shot">` }),
  note({ id: "g2", x: 930, y: 250, width: 250, height: 200, pageId: "p-work",
    html: `<p>Cover ideas</p><img data-img-id="img-p2">` }),
  note({ id: "g3", x: 930, y: 470, width: 250, height: 200, pageId: "p-work",
    html: `<p>Palette</p><img data-img-id="img-p3">` }),
];

const clip = (id, title, ago) => ({
  ...note({ id, x: 0, y: 0, width: 224, height: 200, pageId: "capture-tray",
    html: `<img data-img-id="img-${id}"><p><a href="https://example.com/${id}">${title}</a></p>` }),
  createdAt: Date.now() - ago, editedAt: Date.now() - ago, updatedAt: Date.now() - ago,
});
const clips = [
  clip("c1", "The real cost of a context switch — Field Notes", 0),
  clip("c2", "Pricing page — Q3 comparison", 3600000),
  clip("c3", "Release checklist template", 3 * 86400000),
  clip("c4", "Colour tokens, dark variants", 9 * 86400000),
];

await page.seed("notes", [...board, ...pictures, ...clips]);
await metrics(page);

// Read the picture once before the camera is on: the first ever gallery open
// compiles the recogniser, and forty seconds of that is not a demo. The answer
// is cached in the database, so on camera it is instant.
console.log("warming the recogniser…");
for (const img of ["img-c1", "img-shot"]) {
  await page.evaluate(`import('./js/gallery.js').then(m => m.openGallery(${JSON.stringify(img)}))`);
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(`document.querySelectorAll('.gallery-word').length`)) break;
    await sleep(500);
  }
  await page.evaluate(`document.getElementById('gallery-close').click()`);
  await sleep(300);
}

// Each page remembers how it was last looked at, and a page that has never
// been opened gets fitted to its notes — which on a page holding one note is
// 397%. Every board is framed once here, off camera, so switching pages on
// camera is a cut rather than a lurch.
const prime = async (id, view) => {
  await page.evaluate(`import('./js/pages.js').then(m => m.switchPage(${JSON.stringify(id)}))`);
  await sleep(450);
  await page.evaluate(VIEW(view));
  await sleep(250);
};
await prime("p-work", { x: 30, y: 30, zoom: 0.85 });
await prime("p-loose", { x: 0, y: 0, zoom: 1 });
await prime("p-week", { x: 0, y: 0, zoom: 1 });
await prime("p-res", { x: 40, y: 40, zoom: 1 });
await prime("p-int", { x: 40, y: 40, zoom: 1 });
await prime("p-home", { x: 40, y: 40, zoom: 1 });
await prime("p-scratch", { x: 0, y: 0, zoom: 1 });

// The tray is the subject of one scene and furniture in every other, where it
// would sit under the captions. It opens when the clipper scene needs it.
await page.evaluate(`(() => {
  const t = document.getElementById('tray');
  if (!t.classList.contains('is-collapsed')) document.getElementById('tray-collapse').click();
  return t.className;
})()`);
await sleep(400);
await dress(page);

const icon = "data:image/png;base64," + fs.readFileSync(path.join(root, "icons/icon128.png")).toString("base64");

/* ------------------------------------------------------------------ action */

console.log("rolling…");
recorder.start();
await recorder.attach(page);
const beat = (label) => console.log(`  ${((Date.now() - recorder.t0) / 1000).toFixed(1)}s  ${label}`);

/* --- the title card ----------------------------------------------------- */
await card(page, "Easy Note", "Your new tab, as a canvas", icon);
await sleep(2800);
await card(page, "");
await sleep(800);

/* --- 1. a new tab, and a note ------------------------------------------- */
beat("1 · a note");
await say(page, "Every new tab is a blank canvas", "double-click anywhere and start typing");
await sleep(800);
await clickAt(page, 520, 300, 2);
await sleep(380);
await page.typeKeys("Pick the hero shot for the listing");
await sleep(600);
await clickAt(page, 820, 200);
await sleep(700);

/* --- 2. pages, and pages inside pages ------------------------------------ */
beat("2 · pages");
await say(page, "A page for each thing you are doing", "and pages inside pages when one is not enough");
await sleep(800);
await clickOn(page, "#add-page");
await page.waitFor(`document.activeElement && document.activeElement.classList.contains('page-name')`);
await sleep(300);
await page.typeKeys("Ideas");
await page.key("Enter", "Enter");
await sleep(700);
// Whatever it ended up called, it is the row that was not there before.
const ideas = await page.evaluate(`(() => {
  const known = ${JSON.stringify(pages.map((p) => p.id))};
  const row = [...document.querySelectorAll('#page-tree [data-page-id]')]
    .find((r) => !known.includes(r.dataset.pageId));
  return row ? row.dataset.pageId : null;
})()`);
if (!ideas) throw new Error("the new page never appeared in the tree");
await clickOn(page, `[data-page-id="p-res"]`);
await sleep(800);
await clickOn(page, `[data-page-id="p-int"]`);
await sleep(1500);

/* --- 3. organise: select a few, move them together, line them up --------- */
beat("3 · organise");
await clickOn(page, `[data-page-id="p-loose"]`);
await sleep(550);
await say(page, "Organise a board in one gesture", "select a few notes and move them together");
await sleep(800);

// A marquee has to start on bare canvas. The top-left corner is not bare — the
// sidebar toggle sits in it — so the sweep runs from the empty bottom-left up
// and across instead.
const bare = await page.evaluate(`(() => {
  const r = document.getElementById('canvas').getBoundingClientRect();
  return { x: Math.round(r.left + 30), y: Math.round(r.top + 30) };
})()`);
await glide(page, { x: bare.x, y: bare.y + 590 }, { x: bare.x + 1010, y: bare.y + 20 }, { steps: 20, hold: 90 });
await sleep(500);
const picked = await page.evaluate(`document.querySelectorAll('.note.is-selected').length`);
if (picked < 4) throw new Error(`the marquee caught ${picked} notes — it started on something`);

// The whole selection moves off one note, which is the point of selecting.
const grab = await boxOf(page, `[data-id="l2"] .note-body`);
await glide(page, grab, { x: grab.x - 120, y: grab.y + 150 }, { steps: 18 });
await sleep(600);
await say(page, "Then line them all up at once", "one click drops the lot into a grid");
await sleep(800);
await clickOn(page, "#arrange [data-grid]");
await sleep(1900);

/* --- 4. file them onto a page, and find them again ----------------------- */
beat("4 · filing and search");
await say(page, "Hold them over a page to file them", "it opens underneath, and you drop them in");
await sleep(800);
const filing = await boxOf(page, ".note.is-selected .note-body");
const row = await boxOf(page, `[data-page-id="${ideas}"]`);
await dragVia(page, filing, row, { x: 620, y: 380 });
await sleep(1400);

await say(page, "Every note is one search away", "⌘F looks across every page");
await sleep(700);
await clickOn(page, "#open-search");
await sleep(400);
await page.typeKeys("clipper");
await sleep(1200);
await clickOn(page, ".search-row");
await sleep(1800);

/* --- 5. reminders -------------------------------------------------------- */
beat("5 · reminders");
await say(page, "Ask a note to come back later", "a reminder, and the board tells you when");
await sleep(800);
await clickOn(page, `[data-id="l3"] .note-body`);
await sleep(350);
await clickOn(page, `[data-id="l3"] .note-remind-add`);
await sleep(600);
await pickMenu(page, ".remind-item", "This evening");
await sleep(500);
await point(page, ...(await boxOf(page, `[data-id="l3"] .note-body`).then((b) => [b.x, b.y])));
await sleep(2000);

/* --- 6. Google Drive sync ------------------------------------------------ */
beat("6 · sync");
await say(page, "The same boards on every machine", "sign in once, and Drive keeps them together");
await sleep(700);
await clickOn(page, "#open-sync");
await sleep(2600);
await clickAt(page, 100, 430); // bare sidebar: anywhere on the board is a note
await sleep(600);

/* --- 7. clip the web, file it, read the words inside it ------------------ */
beat("7 · the clipper");
await recorder.detach();
const web = await browser.page();
await metrics(web);
await web.cdp.send("Page.navigate", { url: `http://localhost:${PORT}/` });
await sleep(1600);
await metrics(web);
await web.evaluate(FURNITURE);
await recorder.attach(web);
await say(web, "Clip anything on the web", "⌥⇧S, then drag a box round it");
await sleep(1100);
await web.evaluate(overlaySrc);
await sleep(500);
const box = await web.evaluate(`(() => {
  const r = document.querySelector('.chart').getBoundingClientRect();
  return { x: Math.round(r.left - 12), y: Math.round(r.top - 12),
           x2: Math.round(r.right + 12), y2: Math.round(r.bottom + 12) };
})()`);
await point(web, box.x, box.y, 400);
await glide(web, { x: box.x, y: box.y }, { x: box.x2, y: box.y2 }, { steps: 26, hold: 180 });
await sleep(1100);
await recorder.detach();
await web.close();

await page.cdp.send("Page.bringToFront");
await metrics(page);
await recorder.attach(page);
await say(page, "It lands in the tray", "drag it onto whichever page it belongs to");
await clickOn(page, "#tray-collapse");
await sleep(1200);
const clipCard = await boxOf(page, "#tray-items .tray-item");
const inbox = await boxOf(page, `[data-page-id="p-loose"]`);
if (!clipCard) throw new Error("the tray is empty");
await dragVia(page, clipCard, inbox, { x: 620, y: 330 });
await sleep(1100);
await clickOn(page, "#tray-collapse");
await sleep(700);

await page.evaluate(`window.__demo.lift("top")`); // the gallery owns the bottom of the frame
await say(page, "Open a picture and read it", "the words inside are yours to copy");
await sleep(800);
await clickOn(page, `.note img`, 2);
await sleep(900);
if (!(await page.evaluate(`!document.getElementById('gallery').hidden`))) {
  await clickOn(page, `.note img`, 2);
  await sleep(900);
}
if (!(await page.evaluate(`!document.getElementById('gallery').hidden`))) {
  throw new Error("the gallery never opened — the picture is not clickable where it is");
}
await page.waitFor(`document.querySelectorAll('.gallery-word').length > 0`, { timeout: 12000 });
await sleep(1200);
await page.evaluate(`(() => {
  const words = [...document.querySelectorAll('.gallery-word')];
  if (!words.length) return false;
  const range = document.createRange();
  range.setStart(words[0].firstChild, 0);
  const last = words[Math.min(3, words.length - 1)];
  range.setEnd(last.firstChild, last.textContent.trimEnd().length);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  return sel.toString();
})()`);
await sleep(1500);
if (await boxOf(page, "#gallery-copy:not([hidden])")) {
  await clickOn(page, "#gallery-copy");
  await sleep(1800);
}
await clickOn(page, "#gallery-close");
await page.evaluate(`window.__demo.lift(46)`);
await sleep(600);

/* --- 8. lists ------------------------------------------------------------ */
beat("8 · lists");
await clickOn(page, `[data-page-id="p-week"]`);
await sleep(600);
await say(page, "Keep a few notes in an order", "a list is a box on the same board");
await sleep(800);
await point(page, 340, 240);
await page.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 340, y: 240, button: "right", buttons: 2, clickCount: 1 });
await sleep(80);
await page.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 340, y: 240, button: "right", buttons: 0, clickCount: 1 });
await sleep(420);
await pickMenu(page, ".ctx-item", "New list");
await page.waitFor(`document.activeElement && document.activeElement.classList.contains('list-name')`);
await sleep(280);
await page.typeKeys("This week");
await page.key("Enter", "Enter");
await sleep(500);
for (const id of ["w1", "w2"]) {
  const from = await boxOf(page, `[data-id="${id}"] .note-body`);
  const into = await boxOf(page, ".list");
  if (!from || !into) continue;
  await glide(page, from, { x: into.x, y: into.y + 50 }, { steps: 20 });
  await sleep(300);
}
await sleep(1100);
await say(page, "");

/* --- out ---------------------------------------------------------------- */
beat("dark");
await clickOn(page, `[data-page-id="p-work"]`);
await sleep(260);
await page.evaluate(VIEW({ x: 30, y: 30, zoom: 0.85 }));
await sleep(450);
await say(page, "And it reads right at night", "");
await sleep(600);
await clickOn(page, "#toggle-theme");
await sleep(2400);
await say(page, "");
await sleep(600);

await card(page, "Easy Note", "Free on the Chrome Web Store", icon);
await sleep(2800);

beat("cut");
await recorder.detach();
console.log(`${frames.length} frames over ${(frames[frames.length - 1].t / 1000).toFixed(1)}s`);

/* --------------------------------------------------------------- encoding */

console.log("encoding (real time, so this takes about as long as the video)…");
const enc = await browser.page();
await enc.cdp.send("Page.navigate", { url: `http://localhost:${PORT}/encode.html` });
// Playback is a rAF loop, and Chrome throttles those to a stop in a tab that
// is not on screen.
await enc.cdp.send("Page.bringToFront");

const result = await Promise.race([
  savedAt,
  sleep(240000).then(() => null),
]);
if (!result) throw new Error("the encoder never posted anything back");

const ext = result.mime.startsWith("video/mp4") ? ".mp4" : ".webm";
const out = OUT.replace(/\.mp4$/, ext);
fs.writeFileSync(out, result.body);
console.log(`wrote ${path.relative(root, out)} — ${(result.body.length / 1e6).toFixed(1)} MB, ${result.mime}`);

// The release notes play this file, and Pages serves nothing above docs/, so a
// tour that only lands in store/ leaves the site showing the previous one.
const site = path.join(root, "docs", `demo${ext}`);
fs.writeFileSync(site, result.body);
console.log(`wrote ${path.relative(root, site)} — the copy the site plays`);
if (ext !== ".mp4") console.log("note: docs/release-notes.html asks for demo.mp4, not " + path.basename(site));

await browser.close();
server.close();
if (process.env.KEEP) console.log("frames kept in", work);
else fs.rmSync(work, { recursive: true, force: true });
process.exit(0);
