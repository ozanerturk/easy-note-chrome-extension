// The clipper's crop arithmetic. Everything else about a clip is interaction
// or a database write and is covered by the UI suite; this is the part that
// silently goes wrong by a row of pixels on a scaled display.

import { deviceRect } from "../js/clip/crop.js";

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got:  ${g}\n       want: ${w}`); }
};

console.log("selection -> crop");

// A 1200x800 viewport captured on an unscaled display.
const shot1x = { width: 1200, height: 800 };

eq("1x: the rectangle passes through untouched",
  deviceRect({ x: 100, y: 50, width: 340, height: 210 }, 1, shot1x),
  { x: 100, y: 50, width: 340, height: 210 });

// The same viewport on a Retina display: the capture is twice the size.
const shot2x = { width: 2400, height: 1600 };

eq("2x: CSS pixels are doubled into device pixels",
  deviceRect({ x: 100, y: 50, width: 340, height: 210 }, 2, shot2x),
  { x: 200, y: 100, width: 680, height: 420 });

// A monitor at 150%, where nothing lands on a whole pixel.
eq("1.5x: fractional edges round outwards, never inwards",
  deviceRect({ x: 10, y: 10, width: 101, height: 101 }, 1.5, { width: 1800, height: 1200 }),
  { x: 15, y: 15, width: 152, height: 152 });

console.log("\nclamping to what the capture holds");

eq("a selection running off the right edge is trimmed to it",
  deviceRect({ x: 1100, y: 700, width: 400, height: 400 }, 1, shot1x),
  { x: 1100, y: 700, width: 100, height: 100 });

eq("negative coordinates cannot pull the crop off the front of the image",
  deviceRect({ x: -50, y: -20, width: 200, height: 120 }, 1, shot1x),
  { x: 0, y: 0, width: 150, height: 100 });

eq("a selection entirely past the edge holds nothing",
  deviceRect({ x: 1300, y: 50, width: 100, height: 100 }, 1, shot1x),
  null);

eq("a zero-width selection holds nothing",
  deviceRect({ x: 100, y: 100, width: 0, height: 200 }, 1, shot1x),
  null);

eq("the whole viewport crops to the whole capture",
  deviceRect({ x: 0, y: 0, width: 1200, height: 800 }, 2, shot2x),
  { x: 0, y: 0, width: 2400, height: 1600 });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
