// The bridge's pure parts: markup to plain text, and the shared query helpers.
// The socket and the tools themselves are covered end to end against the relay.

import { htmlToText, capped, MAX_CONTENT } from "../js/bridge/text.js";
import { snippetAround, titleOf, pathFrom, ocrMap, imgIdsIn, startOfDay, localString, pickReminders, validTimeZone } from "../js/notes/query.js";

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got:  ${g}\n       want: ${w}`); }
};

console.log("markup -> text");
eq("paragraphs get their own lines", htmlToText("<p>one</p><p>two</p>"), "one\ntwo");
eq("a heading sits on its own line", htmlToText("<h2>Plan</h2>text after"), "Plan\ntext after");
eq("marks fall away", htmlToText("<p>a <strong>bold</strong> and <a href='x'>link</a></p>"), "a bold and link");
eq("bullets", htmlToText("<ul><li><p>milk</p></li><li><p>eggs</p></li></ul>"), "- milk\n- eggs");
eq("numbered", htmlToText("<ol><li>a</li><li>b</li></ol>"), "1. a\n2. b");
eq("nested list is indented", htmlToText("<ul><li>a<ul><li>b</li></ul></li></ul>"), "- a\n  - b");
eq("table rows join cells with a bar",
  htmlToText("<table><tr><th>Name</th><th>Qty</th></tr><tr><td>Milk</td><td>2</td></tr></table>"),
  "Name | Qty\nMilk | 2");
eq("entities decode", htmlToText("<p>a &amp; b &lt;c&gt; &#65;</p>"), "a & b <c> A");
eq("br is a line break", htmlToText("a<br>b"), "a\nb");
eq("an image says so", htmlToText('<img data-img-id="i1"><p>cap</p>'), "[image]\ncap");
eq("scripts are dropped", htmlToText("<p>hi</p><script>alert(1)</script>"), "hi");
eq("empty", htmlToText(""), "");
eq("under the cap", capped("abc"), { content: "abc", truncated: false });
eq("over the cap", capped("x".repeat(MAX_CONTENT + 5)).truncated, true);
eq("cut at the cap", capped("x".repeat(MAX_CONTENT + 5)).content.length, MAX_CONTENT);

console.log("query helpers");
eq("title is the first non-empty line", titleOf("\n\nHello world\nmore"), "Hello world");
eq("long titles are cut", titleOf("x".repeat(100), 10), "xxxxxxxxx…");
eq("snippet centres on the first hit", snippetAround("a".repeat(200) + " needle " + "b".repeat(200), ["needle"], 100).includes("needle"), true);
eq("snippet stays within its limit", snippetAround("word ".repeat(300), ["word"], 300).length <= 304, true);
eq("snippet with no hit starts at the top", snippetAround("hello there", ["zzz"]), "hello there");
const pages = new Map([["a", { name: "Work", parentId: null }], ["b", { name: "Trips", parentId: "a" }]]);
eq("page path is a breadcrumb", pathFrom(pages, "b"), "Work › Trips");
eq("unknown page has no path", pathFrom(pages, "zz"), "");
eq("ocr rows become a map", [...ocrMap([{ id: "ocr:i1", text: "hi" }, { id: "prefs" }])], [["i1", "hi"]]);
eq("image ids come out of markup", imgIdsIn('<img data-img-id="i1"><img data-img-id="i2">'), ["i1", "i2"]);

console.log("reminders and time zones");
const at = (iso) => Date.parse(iso);
eq("Istanbul midnight is 21:00 UTC the day before", new Date(startOfDay(at("2026-10-06T08:00:00Z"), "Europe/Istanbul")).toISOString(), "2026-10-05T21:00:00.000Z");
eq("tomorrow starts 24h later", new Date(startOfDay(at("2026-10-06T08:00:00Z"), "Europe/Istanbul", 1)).toISOString(), "2026-10-06T21:00:00.000Z");
eq("UTC midnight", new Date(startOfDay(at("2026-10-06T23:59:00Z"), "UTC")).toISOString(), "2026-10-06T00:00:00.000Z");
eq("late evening UTC is already tomorrow in Istanbul", new Date(startOfDay(at("2026-10-06T22:30:00Z"), "Europe/Istanbul")).toISOString(), "2026-10-06T21:00:00.000Z");
eq("a day with the clocks going forward is 23 hours", (startOfDay(at("2026-03-08T12:00:00Z"), "America/New_York", 1) - startOfDay(at("2026-03-08T12:00:00Z"), "America/New_York")) / 3600000, 23);
eq("local string follows the zone", localString(at("2026-10-06T06:30:00Z"), "Europe/Istanbul"), "2026-10-06 09:30");
eq("zone names are checked", [validTimeZone("Europe/Istanbul"), validTimeZone("Mars/Base")], [true, false]);

const now = at("2026-10-06T05:00:00Z"); // 08:00 in Istanbul
const mk = (id, iso) => ({ id, remindAt: at(iso) });
const rem = [
  mk("old", "2026-10-04T10:00:00Z"), mk("early", "2026-10-06T04:00:00Z"), mk("later", "2026-10-06T15:00:00Z"),
  mk("late-night", "2026-10-06T20:59:00Z"), mk("tomorrow", "2026-10-06T21:00:00Z"), mk("far", "2026-10-30T10:00:00Z"), { id: "none" },
];
const ids = (when) => pickReminders(rem, { now, tz: "Europe/Istanbul", when }).map((r) => r.note.id);
eq("today is everything due plus the rest of the day, soonest first", ids("today"), ["old", "early", "later", "late-night"]);
eq("due is what has already passed", ids("due"), ["old", "early"]);
eq("upcoming is after today, within a week", ids("upcoming"), ["tomorrow"]);
eq("all", ids("all").length, 6);
eq("due flag", pickReminders(rem, { now, tz: "Europe/Istanbul", when: "today" }).map((r) => r.due), [true, true, false, false]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
