#!/usr/bin/env node
//
//   npm run test:ui             every suite
//   npm run test:ui -- gallery  only the suites whose name matches
//   npm run test:ui -- --headed one visible Chrome, one suite at a time
//   npm run test:ui -- -j 2     how many Chromes to run side by side
//
// Each suite gets a fresh page and an empty database. Suites share nothing but
// the extension's origin, so they are spread over several headless Chromes —
// one profile each — rather than queued behind one another in a single one.

import fs from "node:fs";
import os from "node:os";
import { launch, suite, sleep } from "./harness.mjs";

const SUITES = ["./notes.test.mjs", "./navigate.test.mjs", "./pages.test.mjs", "./clipboard.test.mjs", "./editor.test.mjs", "./lock.test.mjs", "./reminders.test.mjs", "./clip.test.mjs", "./tray.test.mjs", "./spring.test.mjs", "./sidebar.test.mjs", "./gallery.test.mjs", "./ocr.test.mjs", "./history.test.mjs", "./lists.test.mjs", "./tables.test.mjs", "./apps.test.mjs", "./search.test.mjs", "./origin.test.mjs", "./grouping.test.mjs", "./sums.test.mjs", "./sync.test.mjs", "./floating.test.mjs"];

const args = process.argv.slice(2);
const headed = args.includes("--headed");
const jAt = args.findIndex((a) => a === "-j" || a === "--jobs");
const filters = args
  .filter((a, i) => !a.startsWith("-") && !(jAt >= 0 && i === jAt + 1))
  .map((a) => a.toLowerCase());

const wanted = filters.length
  ? SUITES.filter((p) => filters.some((f) => p.toLowerCase().includes(f)))
  : SUITES;

if (!wanted.length) {
  console.error(`no suite matches ${filters.join(", ")}\nhave: ${SUITES.map((p) => p.slice(2, -9)).join(", ")}`);
  process.exit(1);
}

// a starved Chrome drops gestures: past ~60% of the cores the run gets no
// faster, only flakier (on 10 cores, 6 and 8 Chromes tie and 10 fails)
const jobs = headed
  ? 1
  : Math.max(1, Math.min(wanted.length, jAt >= 0 ? Number(args[jAt + 1]) : Math.floor(os.cpus().length * 0.6)));

const runStarted = Date.now();
const results = [];
// longest first, so the slow suites start together instead of one of them
// arriving last to a lane that is otherwise done. a file's size is a fair
// stand-in for how long it takes.
const size = (p) => fs.statSync(new URL(p, import.meta.url)).size;
const queue = [...wanted].sort((a, b) => size(b) - size(a));

async function lane(index) {
  // distinct port ranges, so two launches racing for a free port never meet
  const browser = await launch({ port: 9333 + index * 30, headless: !headed });
  try {
    for (let path; (path = queue.shift()); ) {
      const started = Date.now();
      const module = await import(path);
      // a suite's lines are held back and printed whole, so parallel suites
      // don't interleave
      const lines = [];
      // CHECK_TIMES=1 stamps each check with the seconds into its suite, to
      // show where a slow suite spends its time
      const stamp = () => (process.env.CHECK_TIMES ? `${((Date.now() - started) / 1000).toFixed(1).padStart(5)}s` : "");
      const s = suite(module.title, (line) => lines.push(stamp() + line));

      const page = await browser.page();
      await page.reset();
      try {
        await module.default(page, s);
      } catch (err) {
        s.check(`the suite ran to the end`, false, String(err.message || err));
      }
      await page.close();

      const secs = (Date.now() - started) / 1000;
      console.log(`\n${module.title}  (${secs.toFixed(1)}s)\n${lines.join("\n")}`);
      results.push({ title: module.title, secs, checks: s.checks.length, failures: s.failures });
      await sleep(100);
    }
  } finally {
    await browser.close();
  }
}

await Promise.all(Array.from({ length: jobs }, (_, i) => lane(i)));

const total = results.reduce((n, r) => n + r.checks, 0);
const failures = results.flatMap((r) => r.failures.map((f) => ({ ...f, title: r.title })));

// slowest first, so the next place to shave is always at the top
if (results.length > 1) {
  console.log(`\nslowest suites`);
  for (const r of [...results].sort((a, b) => b.secs - a.secs).slice(0, 6)) {
    console.log(`  ${r.secs.toFixed(1).padStart(6)}s  ${r.title}`);
  }
}
if (failures.length) {
  console.log(`\nfailed`);
  for (const f of failures) console.log(`  ${f.title}: ${f.label}${f.detail ? ` — ${f.detail}` : ""}`);
}

const wall = ((Date.now() - runStarted) / 1000).toFixed(1);
console.log(`\n${total - failures.length}/${total} passed in ${wall}s across ${jobs} Chrome${jobs > 1 ? "s" : ""}${wanted.length < SUITES.length ? ` (${wanted.length}/${SUITES.length} suites)` : ""}`);
process.exit(failures.length ? 1 : 0);
