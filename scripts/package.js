#!/usr/bin/env node

// Builds the zip to upload to the Chrome Web Store.
//
//   npm run package  ->  dist/easy-note-<version>.zip
//
// Only what the extension needs at runtime goes in. Development files, the
// downloaded Chrome, browser profiles, tests and internal engineering docs are
// all left out, and the manifest `key` is stripped — see below.

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

// Everything the extension loads at runtime.
const INCLUDE = [
  "manifest.json",
  "newtab.html",
  "css",
  "js",
  "icons",
  "docs/release-notes.html", // the What's new pill links here
];

// Internal docs that would otherwise be swept in with docs/.
const EXCLUDE_PATTERNS = [/\.DS_Store$/, /\/\./];

function collect(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) throw new Error(`missing from the package: ${rel}`);
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [rel];
  return fs
    .readdirSync(abs)
    .flatMap((entry) => collect(path.join(rel, entry)))
    .filter((f) => !EXCLUDE_PATTERNS.some((re) => re.test(f)));
}

const files = INCLUDE.flatMap(collect).sort();

const stage = fs.mkdtempSync(path.join(os.tmpdir(), "easynote-pkg-"));
for (const rel of files) {
  const dest = path.join(stage, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(root, rel), dest);
}

// The `key` pins the extension id during development so OAuth works against
// the published client. The Web Store signs the upload with the item's own
// key, so shipping it is redundant and only risks a mismatch.
const staged = JSON.parse(fs.readFileSync(path.join(stage, "manifest.json"), "utf8"));
const hadKey = "key" in staged;
delete staged.key;
fs.writeFileSync(path.join(stage, "manifest.json"), JSON.stringify(staged, null, 2) + "\n");

// The hosted release-notes page carries a Google Analytics tag. MV3 blocks
// remote scripts on extension pages, so inside the package it could never run
// and would only log a CSP error — strip it rather than ship a dead reference
// a store reviewer has to think about.
const notesPath = path.join(stage, "docs/release-notes.html");
let notes = fs.readFileSync(notesPath, "utf8");
const stripped = notes.replace(/<!-- analytics:start[\s\S]*?analytics:end -->\n?/g, "");
const removedAnalytics = stripped !== notes;
fs.writeFileSync(notesPath, stripped);

const dist = path.join(root, "dist");
fs.mkdirSync(dist, { recursive: true });
const zipPath = path.join(dist, `easy-note-${manifest.version}.zip`);
fs.rmSync(zipPath, { force: true });

execFileSync("zip", ["-r", "-q", "-X", zipPath, "."], { cwd: stage });
fs.rmSync(stage, { recursive: true, force: true });

const kb = (fs.statSync(zipPath).size / 1024).toFixed(0);
console.log(`Easy Note ${manifest.version}`);
console.log(`  ${files.length} files -> dist/easy-note-${manifest.version}.zip (${kb} KB)`);
if (hadKey) console.log("  manifest `key` stripped for upload");
if (removedAnalytics) console.log("  analytics tag stripped from the bundled release notes");
