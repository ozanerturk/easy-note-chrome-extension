#!/usr/bin/env node
//
//   npm run test:ui
//
// One browser, one suite per fresh page, each starting from an empty database.

import { launch, suite, sleep } from "./harness.mjs";

const SUITES = ["./notes.test.mjs", "./navigate.test.mjs", "./pages.test.mjs", "./clipboard.test.mjs", "./editor.test.mjs", "./lock.test.mjs", "./reminders.test.mjs", "./clip.test.mjs", "./tray.test.mjs", "./spring.test.mjs", "./home.test.mjs", "./sidebar.test.mjs"];

const browser = await launch();
let failed = 0;
let total = 0;

try {
  for (const path of SUITES) {
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

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
