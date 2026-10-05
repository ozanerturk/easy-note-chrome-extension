import { clampBox, defaultBox, boxOf, tuckedX, tuckedSpot, DEFAULT_WIDTH, CASCADE, TUCK_TIP, TUCK_RIGHT_GAP, TUCK_TAB, TUCK_GAP } from "../js/float/geometry.js";

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got:  ${g}\n       want: ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

console.log("Floating geometry");

const desktop = { width: 1600, height: 900 };
const laptop = { width: 1280, height: 720 };
const phone = { width: 380, height: 600 };

eq("a box inside the viewport is left alone",
  clampBox({ x: 100, y: 120, width: 260, height: 180 }, desktop),
  { x: 100, y: 120, width: 260, height: 180 });

// The case the sync decision creates: a position saved on a big monitor
// arriving on a machine that never agreed to it.
const wide = clampBox({ x: 1500, y: 850, width: 260, height: 180 }, desktop);
const narrowed = clampBox(wide, laptop);
ok("a box saved on a wide screen stays reachable on a narrow one",
  narrowed.x + narrowed.width > 0 && narrowed.x < laptop.width && narrowed.y < laptop.height);

ok("a box dragged off the right keeps a sliver on screen",
  clampBox({ x: 99999, y: 10, width: 260, height: 180 }, laptop).x < laptop.width);

ok("a box dragged off the left keeps a sliver on screen",
  clampBox({ x: -99999, y: 10, width: 260, height: 180 }, laptop).x + 260 > 0);

eq("a box is never above the top of the viewport",
  clampBox({ x: 10, y: -500, width: 260, height: 180 }, laptop).y, 0);

const huge = clampBox({ x: 0, y: 0, width: 9999, height: 9999 }, phone);
eq("a box bigger than the viewport is cut down to it", { w: huge.width, h: huge.height },
  { w: phone.width, h: phone.height });

eq("a box with nonsense sizes falls back to the default width",
  clampBox({ x: 10, y: 10, width: undefined, height: null }, desktop).width, DEFAULT_WIDTH);

// The cascade, so two notes floated in a row are not one note as far as the
// user can tell.
const first = defaultBox(desktop, 0);
const second = defaultBox(desktop, 1);
eq("the second floating note steps clear of the first",
  { dx: second.x - first.x, dy: second.y - first.y }, { dx: CASCADE, dy: CASCADE });

ok("the cascade comes back round rather than marching off screen",
  defaultBox(desktop, 60).x === first.x);

ok("a default box is fully on screen", first.x >= 0 && first.y >= 0 &&
  first.x + first.width <= desktop.width && first.y + first.height <= desktop.height);

// boxOf is what both the board and the widget call on render.
eq("a note that has never floated is given a default box",
  boxOf({ floatingGeometry: null }, desktop, 0), first);

eq("a note that has floated keeps its own box",
  boxOf({ floatingGeometry: { x: 40, y: 50, width: 200, height: 100 } }, desktop, 3),
  { x: 40, y: 50, width: 200, height: 100 });

ok("a remembered box is still clamped on the way out",
  boxOf({ floatingGeometry: { x: 5000, y: 5000, width: 200, height: 100 } }, phone, 0).y < phone.height);

// Tucking a note away at the side of the page.
const card = { x: 100, y: 50, width: 260, height: 180 };
const tuckedLeft = tuckedX(card, 1280);
eq("a note tucks away to the left", tuckedLeft.toLeft, true);
eq("leaving only its tip on the page", tuckedLeft.x + card.width, TUCK_TIP);
eq("a note in the middle of the page still goes left", tuckedX({ ...card, x: 560 }, 1280).toLeft, true);
const tuckedRight = tuckedX({ ...card, x: 1000 }, 1280);
eq("a note well over to the right goes right", tuckedRight.toLeft, false);
eq("keeping its tip clear of a scrollbar drawn over the right edge",
  1280 - tuckedRight.x, TUCK_TIP + TUCK_RIGHT_GAP);

const screen = { width: 1280, height: 720 };
eq("a note tucks at the height it was", tuckedSpot(card, screen), { side: "left", y: 50 });
const tuckedSecond = tuckedSpot({ ...card, y: 70 }, screen, [{ side: "left", y: 50 }]);
ok("a second note tucked from about the same height gets a tab of its own",
  tuckedSecond.side === "left" && Math.abs(tuckedSecond.y - 50) >= TUCK_TAB + TUCK_GAP);
eq("the nearest free height, not the first one down the edge", tuckedSecond.y, 50 + TUCK_TAB + TUCK_GAP);
eq("a tab on the other side is no obstacle",
  tuckedSpot({ ...card, y: 50 }, screen, [{ side: "right", y: 50 }]), { side: "left", y: 50 });
ok("a note tucked from below the bottom keeps its tab on the page",
  tuckedSpot({ ...card, y: 5000 }, screen).y + TUCK_TAB <= screen.height);
const crowded = Array.from({ length: 40 }, (_, i) => ({ side: "left", y: i * 10 }));
ok("an edge with no room left still takes the note", Number.isFinite(tuckedSpot(card, screen, crowded).y));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
