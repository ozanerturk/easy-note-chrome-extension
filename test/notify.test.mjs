import { planNotices, noticeText } from "../js/notify/plan.js";

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got:  ${g}\n       want: ${w}`); }
};

const NOW = 1_000_000;
const note = (id, remindAt, extra = {}) => ({ id, pageId: "p", html: "", remindAt, ...extra });
const ids = (list) => list.map((n) => n.id);

console.log("What to announce");

{
  const notes = [note("a", NOW - 10), note("b", NOW + 500), note("c", NOW + 100), note("d")];
  const plan = planNotices(notes, null, NOW);
  eq("the first run announces nothing already due", ids(plan.show), []);
  eq("but remembers it as seen", plan.shown, { a: NOW - 10 });
  eq("and wakes for the soonest one still to come", plan.next, NOW + 100);
}

{
  const notes = [note("a", NOW - 10), note("b", NOW - 50), note("c", NOW - 5)];
  const plan = planNotices(notes, { c: NOW - 5 }, NOW);
  eq("announces what came due since, oldest first", ids(plan.show), ["b", "a"]);
  eq("but not what was already announced", plan.show.some((n) => n.id === "c"), false);
  eq("with nothing left to wake for", plan.next, null);
}

{
  const notes = [note("a", NOW + 60), note("b", NOW - 1, { deleted: true }), note("c")];
  const plan = planNotices(notes, { a: NOW - 100, b: NOW - 1, c: NOW - 3 }, NOW);
  eq("takes down one moved into the future, deleted, or dismissed", plan.clear.sort(), ["a", "b", "c"]);
  eq("and forgets them", plan.shown, {});
  eq("a deleted note is never announced", ids(plan.show), []);
}

{
  const plan = planNotices([note("a", NOW - 1)], { a: NOW - 900 }, NOW);
  eq("a reminder set again is news again", ids(plan.show), ["a"]);
  eq("replacing the old one rather than clearing it", plan.clear, []);
}

{
  const plan = planNotices([note("a", NOW)], {}, NOW);
  eq("due at exactly now counts", ids(plan.show), ["a"]);
}

{
  const notes = [note("a", NOW - 5), note("b", NOW - 9), note("c", NOW + 50)];
  const blocked = planNotices(notes, { b: NOW - 9, gone: NOW - 1 }, NOW, { canShow: false });
  eq("without the permission nothing is announced", ids(blocked.show), []);
  eq("nor written down as announced", blocked.shown, { b: NOW - 9 });
  eq("but it still wakes for the next one", blocked.next, NOW + 50);
  const granted = planNotices(notes, blocked.shown, NOW + 1);
  eq("so saying yes a moment later announces it", ids(granted.show), ["a"]);
}

console.log("\nWhat it says");

eq("first line, then the rest",
  noticeText("<h1>Water the plants</h1><p>the fern</p><p>and the <b>cactus</b></p>"),
  { title: "Water the plants", body: "the fern and the cactus" });
eq("one line is only a title", noticeText("<p>Call Sam</p>"), { title: "Call Sam", body: "" });
eq("entities read as text", noticeText("<p>Tom &amp; Jerry &lt;3&nbsp;&#8217;s &#x1F600;</p>").title, "Tom & Jerry <3 ’s 😀");
eq("pictures say nothing", noticeText('<img data-img-id="x"><p>caption</p>'), { title: "caption", body: "" });
eq("a picture alone says nothing at all", noticeText('<img data-img-id="x">'), { title: "", body: "" });
eq("list items are lines", noticeText("<ul><li><p>milk</p></li><li><p>eggs</p></li></ul>"), { title: "milk", body: "eggs" });
eq("table cells keep a space between them", noticeText("<table><tr><td>a</td><td>b</td></tr></table>").title, "a b");
eq("a long first line is cut", noticeText(`<p>${"x".repeat(200)}</p>`).title.length, 80);
eq("and says so", noticeText(`<p>${"x".repeat(200)}</p>`).title.endsWith("…"), true);
eq("an address reads as its site",
  noticeText('<p>REPO and webstore</p><p>easynote <a href="https://chromewebstore.google.com/detail/easy-note/hheob?hl=en">https://chromewebstore.google.com/detail/easy-note/hheob?hl=en</a></p>'),
  { title: "REPO and webstore", body: "easynote chromewebstore.google.com" });
eq("without the www", noticeText("<p>see https://www.example.com/a/b</p>").title, "see example.com");
eq("keeping the punctuation after it", noticeText("<p>(docs at https://github.com/x/y).</p>").title, "(docs at github.com).");
eq("a link's own words are left alone", noticeText('<p><a href="https://x.com/long/path">the plan</a></p>').title, "the plan");
eq("empty is empty", noticeText(undefined), { title: "", body: "" });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
