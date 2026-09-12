#!/usr/bin/env node

// Puts the real extension on the web, so the site can offer a board to try
// rather than a picture of one.
//
//   node scripts/demo.mjs  ->  docs/demo/
//
// GitHub Pages serves docs/, and nothing above it, so the app has to be copied
// down there. It is copied rather than rewritten: the demo is the same
// newtab.html, the same js/, the same css/ the extension ships, so it cannot
// drift into being a different product that happens to look similar. What it
// gets instead of an extension around it is `demo.js` — a small stand-in for
// the handful of `chrome.*` calls a page outside an extension does not have.
//
// The output is generated but committed, because Pages serves what is in the
// repository. `npm run build` rewrites it; a diff there means the app changed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "docs", "demo");

// The OCR models are seven megabytes of binary that only matter once somebody
// opens a picture in the gallery, and a demo board starts empty. Left out, the
// engine simply never starts — `textIn()` already treats a picture it cannot
// read as a picture with nothing written on it — and the site stays small
// enough to serve. The ESM wrapper stays because ocr.js imports it outright.
const SKIP = new Set([
  "eng.traineddata.gz",
  "tur.traineddata.gz",
  "tesseract-core-simd-lstm.js",
  "tesseract-core-simd-lstm.wasm",
  "worker.min.js",
]);

const version = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8")).version;

/* ------------------------------------------------------------------ copying */

function copy(rel) {
  const from = path.join(root, rel);
  const to = path.join(out, rel);
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from)) {
      if (entry.startsWith(".") || SKIP.has(entry)) continue;
      copy(path.join(rel, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const dir of ["js", "css", "icons"]) copy(dir);

/* --------------------------------------------------------------- the shim */

// Everything the app asks Chrome for, and what a web page can honestly answer.
// Signing in is the one thing genuinely missing: chrome.identity is left
// undefined on purpose, which is the case syncui.js already handles by saying
// sync is unavailable rather than by breaking.
const shim = `// Written by scripts/demo.mjs — the extension APIs, standing in for a web page.
//
// The demo runs the extension's own code unchanged, which means it calls a few
// chrome.* APIs that do not exist here. Each one below answers the way the app
// expects; nothing pretends to be more than it is. chrome.identity is left out
// entirely, so Google Drive sync reports itself unavailable — which it is.
(() => {
  const noop = () => {};
  const shim = {
    runtime: {
      id: "easy-note-demo",
      getManifest: () => ({ version: ${JSON.stringify(version)} }),
      getURL: (p) => new URL(p, document.baseURI).href,
      onMessage: { addListener: noop, removeListener: noop },
      sendMessage: () => Promise.resolve(),
      lastError: null,
    },
  };
  try {
    Object.defineProperty(window, "chrome", { value: shim, writable: true, configurable: true });
  } catch (err) {
    window.chrome = shim;
  }
})();
`;
fs.writeFileSync(path.join(out, "demo.js"), shim);

/* ---------------------------------------------------------------- the page */

let html = fs.readFileSync(path.join(root, "newtab.html"), "utf8");

// The shim has to be in place before any of the app's own scripts run, and
// boot.js is the first of them.
html = html.replace('<script src="js/boot.js"></script>', '<script src="demo.js"></script>\n    <script src="js/boot.js"></script>');
if (!html.includes('src="demo.js"')) throw new Error("newtab.html no longer loads js/boot.js first — the shim has nowhere to go");

// A demo opened on its own deserves to say what it is and where to get it.
// Inside the iframe on the release notes the page says that already, so the
// banner hides itself when it is not the top window.
const banner = `
    <div id="demo-banner">
      <span><strong>Easy Note</strong> — the real thing, running in this tab. Your notes stay in this browser.</span>
      <a href="https://chromewebstore.google.com/detail/easy-note/hheobakelknbjicekbkmijjgcbephcef">Add to your browser</a>
    </div>
    <style>
      #demo-banner {
        position: fixed; z-index: 1000; left: 50%; top: 12px; transform: translateX(-50%);
        display: flex; align-items: center; gap: 12px; max-width: min(680px, calc(100vw - 24px));
        padding: 8px 10px 8px 14px; border-radius: 999px;
        background: #2f2c27; color: #f4f1ea; font-size: 13px;
        box-shadow: 0 6px 22px rgba(0,0,0,.3);
      }
      #demo-banner span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      #demo-banner a {
        flex: 0 0 auto; padding: 5px 12px; border-radius: 999px;
        background: #f4f1ea; color: #2f2c27; text-decoration: none; font-weight: 600;
      }
      @media (max-width: 620px) { #demo-banner span { display: none; } }
    </style>
    <script>
      // Inside the iframe on the release notes, the page around it already
      // says all this.
      if (window.top !== window.self) document.getElementById("demo-banner").remove();
    </script>
`;
html = html.replace("</body>", `${banner}  </body>`);

// The title is what a browser tab full of open pages has to distinguish.
html = html.replace(/<title>[\s\S]*?<\/title>/, "<title>Easy Note — try it here</title>");

fs.writeFileSync(path.join(out, "index.html"), html);

const size = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .reduce((sum, e) => sum + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);

console.log(`  docs/demo/  the app itself, ${(size(out) / 1024).toFixed(0)} KB`);
