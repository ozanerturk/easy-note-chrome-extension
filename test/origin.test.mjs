import { EDGE, inBounds, shiftInto, nudgeInside } from "../js/origin.js";

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got:  ${g}\n       want: ${w}`); }
};

console.log("The origin");

eq("the edge is one grid step", EDGE, 24);
eq("a point past it comes inside", inBounds(-40, 10), { x: 24, y: 24 });
eq("a point inside stays put", inBounds(300, 500), { x: 300, y: 500 });

eq("a group already inside needs no shift", shiftInto([{ x: 24, y: 24 }, { x: 900, y: 40 }]), { dx: 0, dy: 0 });
eq("a group past it moves by its furthest member",
  shiftInto([{ x: -500, y: 100 }, { x: 60, y: -20 }]), { dx: 524, dy: 44 });
eq("nothing to shift is no shift", shiftInto([]), { dx: 0, dy: 0 });
eq("missing coordinates count as zero", shiftInto([{}]), { dx: 24, dy: 24 });

{
  const boxes = [{ x: -100, y: 30 }, { x: 50, y: 80 }];
  nudgeInside(boxes);
  eq("nudging moves the group as one", boxes, [{ x: 24, y: 30 }, { x: 174, y: 80 }]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
