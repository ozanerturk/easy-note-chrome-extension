// The tips can only stay quiet if every one of them can be retired.
//
// A tip whose feature has no markUsed() call keeps coming back to somebody who
// already knows the thing — three times, spread over weeks, which is precisely
// the nagging the whole design exists to avoid. That failure is invisible at
// runtime and easy to introduce by adding a line to the list, so it is checked
// here instead.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let pass = 0, fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ""}`); }
};

const jsFiles = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "vendor" ? [] : jsFiles(full);
    return e.name.endsWith(".js") ? [full] : [];
  });

const source = jsFiles(path.join(root, "js"))
  .map((f) => fs.readFileSync(f, "utf8"))
  .join("\n");

const tipsSrc = fs.readFileSync(path.join(root, "js/tips.js"), "utf8");
const keys = [...tipsSrc.matchAll(/\{ key: "([a-z]+)"/g)].map((m) => m[1]);
// Every call except the ones inside tips.js itself, which is the definition.
const hooks = new Set(
  [...source.matchAll(/markUsed\("([a-z]+)"\)/g)].map((m) => m[1])
);

console.log("tips");

ok("there are tips at all", keys.length > 0, `${keys.length} found`);
ok("no duplicate keys", new Set(keys).size === keys.length, keys.join(", "));

for (const key of keys) {
  ok(`"${key}" can be retired by using the feature`, hooks.has(key),
    `no markUsed("${key}") anywhere in js/`);
}

const orphans = [...hooks].filter((h) => !keys.includes(h));
ok("no hooks left behind by a removed tip", orphans.length === 0, orphans.join(", "));

// The gate that keeps it from ever being loud.
const num = (name) => {
  const m = tipsSrc.match(new RegExp("const " + name + " = (\\d+)"));
  // Null rather than a default: a constant that has been renamed must fail the
  // check, not quietly satisfy it.
  return m ? Number(m[1]) : null;
};
const atLeast = (name, floor) => {
  const v = num(name);
  ok(`${name} is set, and is at least ${floor}`, v !== null && v >= floor, String(v));
};
const atMost = (name, ceiling) => {
  const v = num(name);
  ok(`${name} is set, and is at most ${ceiling}`, v !== null && v <= ceiling, String(v));
};

atLeast("DELAY_MS", 5000); // never the moment the board appears
atLeast("REST_DAYS", 3); // days between any two tips
atMost("MAX_SHOWS", 3); // then it gives up on that tip for good
atLeast("MIN_NOTES", 1); // nothing at all on an empty board

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
