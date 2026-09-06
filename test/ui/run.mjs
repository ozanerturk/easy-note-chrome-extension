#!/usr/bin/env node
//
//   npm run test:ui             every suite
//   npm run test:ui -- gallery  only the suites whose name matches
//
// One browser, one suite per fresh page, each starting from an empty database.

import { launch, suite, sleep } from "./harness.mjs";

const SUITES = ["./notes.test.mjs", "./navigate.test.mjs", "./pages.test.mjs", "./clipboard.test.mjs", "./editor.test.mjs", "./lock.test.mjs", "./reminders.test.mjs", "./clip.test.mjs", "./tray.test.mjs", "./spring.test.mjs", "./home.test.mjs", "./sidebar.test.mjs", "./gallery.test.mjs", "./ocr.test.mjs", "./history.test.mjs"];

const filters = process.argv.slice(2).map((a) => a.toLowerCase());
const wanted = filters.length
  ? SUITES.filter((p) => filters.some((f) => p.toLowerCase().includes(f)))
  : SUITES;

if (!wanted.length) {
  console.error(`no suite matches ${filters.join(", ")}\nhave: ${SUITES.map((p) => p.slice(2, -9)).join(", ")}`);
  process.exit(1);
}

const browser = await launch();
let failed = 0;
let total = 0;

try {
  for (const path of wanted) {
    const module = await import(path);
    const s = suite(module.title);
    console.log(`\n${module.title}`);

    const page = await browser.page();
    await page.reset();
    try {
      await module.default(page, s);
    } catch (err) {
      s.check(`the suite ran to the end`, false, String(err.message || err));
    }
    await page.close();
    await sleep(200);

    total += s.checks.length;
    failed += s.failures.length;
  }
} finally {
  await browser.close();
}

console.log(`\n${total - failed}/${total} passed${wanted.length < SUITES.length ? ` (${wanted.length}/${SUITES.length} suites)` : ""}`);
process.exit(failed ? 1 : 0);
