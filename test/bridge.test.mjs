// The bridge's pure parts: markup to plain text, and the shared query helpers.
// The socket and the tools themselves are covered end to end against the relay.

import { htmlToText, capped, MAX_CONTENT } from "../js/bridge/text.js";
import { snippetAround, titleOf, pathFrom, ocrMap, imgIdsIn } from "../js/notes/query.js";

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
