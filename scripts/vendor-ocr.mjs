#!/usr/bin/env node

// Puts everything the OCR engine needs inside the extension.
//
//   node scripts/vendor-ocr.mjs  ->  js/vendor/tesseract/
//
// Manifest V3 forbids remote code, and a new-tab extension that phones a CDN
// for a multi-megabyte binary is a permission, a privacy disclosure and an
// argument with a reviewer that this feature does not need to have. So the
// engine, its wasm core and the language data all ship in the package and
// none of them is ever fetched at runtime.
//
// The language files are the one thing not on npm; they come from the tessdata
// mirror tesseract.js itself defaults to, in the "fast" flavour — a fifth of
// the size of the full models, and the difference is invisible on the kind of
// picture that ends up in a note.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "js", "vendor", "tesseract");

// The engine, and the worker it runs in. The worker is a classic worker script
// loaded straight from the extension: the default spawns it from a blob URL,
// which an extension page's CSP will not have.
const COPY = [
  ["tesseract.js/dist/tesseract.esm.min.js", "tesseract.esm.js"],
  ["tesseract.js/dist/worker.min.js", "worker.min.js"],
  // LSTM only — the legacy engine is another model to ship and nothing here
  // asks for it. Every Chrome that can run Manifest V3 has wasm SIMD, so the
  // SIMD build is the only core worth carrying.
  ["tesseract.js-core/tesseract-core-simd-lstm.js", "tesseract-core-simd-lstm.js"],
  ["tesseract.js-core/tesseract-core-simd-lstm.wasm", "tesseract-core-simd-lstm.wasm"],
];

const LANGS = ["eng", "tur"];
const TESSDATA = "https://tessdata.projectnaptha.com/4.0.0_fast";

fs.mkdirSync(out, { recursive: true });

for (const [from, to] of COPY) {
  const src = path.join(root, "node_modules", from);
  if (!fs.existsSync(src)) {
    throw new Error(`missing ${from} — run npm install first`);
  }
  fs.copyFileSync(src, path.join(out, to));
  console.log(`  ${to}  ${(fs.statSync(src).size / 1e6).toFixed(2)} MB`);
}

for (const lang of LANGS) {
  const name = `${lang}.traineddata.gz`;
  const dest = path.join(out, name);
  if (fs.existsSync(dest)) {
    console.log(`  ${name}  already here`);
    continue;
  }
  const res = await fetch(`${TESSDATA}/${name}`);
  if (!res.ok) throw new Error(`${name}: ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`  ${name}  ${(fs.statSync(dest).size / 1e6).toFixed(2)} MB`);
}
