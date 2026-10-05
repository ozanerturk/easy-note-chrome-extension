import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { capped, htmlToText } from "../src/shared/text.js";
import * as q from "../src/shared/query.js";

// The reading logic exists twice: in the extension (plain JS, which has to run in a
// service worker) and here (TypeScript, which has to run on the relay). They must
// answer identically, so each is run over the same inputs and compared. The
// extension's source is not inside the docker build context, so this only runs
// from the repository.
const ext = resolve(import.meta.dirname, "../../js");
const here = existsSync(resolve(ext, "bridge/text.js"));

describe.skipIf(!here)("relay and extension read notes the same way", async () => {
  const text = here ? await import(pathToFileURL(resolve(ext, "bridge/text.js")).href) : null;
  const query = here ? await import(pathToFileURL(resolve(ext, "notes/query.js")).href) : null;

  const HTML = [
    "",
    "<p>one</p><p>two</p>",
    "<h2>Plan</h2>text after",
    "<p>a <strong>bold</strong> and <a href='x'>link</a></p>",
    "<ul><li><p>milk</p></li><li><p>eggs</p></li></ul>",
    "<ol><li>a</li><li>b<ul><li>nested</li></ul></li></ol>",
    "<table><tr><th>Day</th><th>City</th></tr><tr><td>1</td><td>Lisbon</td></tr></table>",
    "<p>a &amp; b &lt;c&gt; &#65; &#x1F600; &nbsp;x</p>",
    "a<br>b<br/>c",
    '<img data-img-id="i1"><p>cap</p>',
    "<p>hi</p><script>alert(1)</script><style>p{}</style><!-- c -->",
    "<pre>  keep   spacing\n here</pre><p>after</p>",
    "<blockquote>quoted</blockquote><div>block</div>text",
    "<p>unterminated <b>bold",
    "<p>çok güzel — İstanbul ğüşıöç</p>",
    "x".repeat(60_000),
  ];

  it("htmlToText", () => {
    for (const html of HTML) expect(htmlToText(html), html.slice(0, 40)).toBe(text.htmlToText(html));
  });

  it("capped", () => {
    for (const s of ["abc", "x".repeat(50_001)]) expect(capped(s)).toEqual(text.capped(s));
  });

  it("titles, snippets, paths", () => {
    const long = "word ".repeat(300);
    for (const s of ["\n\nHello world\nmore", "x".repeat(100), "", long]) expect(q.titleOf(s)).toBe(query.titleOf(s));
    for (const [s, terms] of [[long, ["word"]], ["a".repeat(200) + " needle " + "b".repeat(200), ["needle"]], ["hello there", ["zzz"]], ["", []]] as [string, string[]][]) {
      expect(q.snippetAround(s, terms)).toBe(query.snippetAround(s, terms));
    }
    const pages = new Map([["a", { id: "a", name: "Work", parentId: null }], ["b", { id: "b", name: "Trips", parentId: "a" }]]);
    for (const id of ["a", "b", "zz"]) expect(q.pathFrom(pages, id)).toBe(query.pathFrom(pages, id));
    expect(q.imgIdsIn('<img data-img-id="i1"><img data-img-id="i2">')).toEqual(query.imgIdsIn('<img data-img-id="i1"><img data-img-id="i2">'));
  });

  it("time zones and days, including a daylight-saving change", () => {
    const instants = ["2026-10-06T08:00:00Z", "2026-10-06T22:30:00Z", "2026-03-08T12:00:00Z", "2026-11-01T05:30:00Z", "2026-03-29T00:30:00Z"].map(Date.parse);
    for (const tz of ["UTC", "Europe/Istanbul", "America/New_York", "Asia/Kolkata", "Pacific/Auckland"]) {
      for (const at of instants) {
        for (const plus of [0, 1, 8]) expect(q.startOfDay(at, tz, plus), `${tz} ${at} +${plus}`).toBe(query.startOfDay(at, tz, plus));
        expect(q.localString(at, tz)).toBe(query.localString(at, tz));
      }
    }
    expect([q.validTimeZone("Europe/Istanbul"), q.validTimeZone("Mars/Base")]).toEqual([query.validTimeZone("Europe/Istanbul"), query.validTimeZone("Mars/Base")]);
    expect([...q.WHEN]).toEqual(query.WHEN);
  });

  it("which reminders, in what order", () => {
    const now = Date.parse("2026-10-06T05:00:00Z");
    const notes = [
      { id: "a", remindAt: Date.parse("2026-10-04T10:00:00Z") }, { id: "b", remindAt: Date.parse("2026-10-06T04:00:00Z") },
      { id: "c", remindAt: Date.parse("2026-10-06T15:00:00Z") }, { id: "d", remindAt: Date.parse("2026-10-06T21:00:00Z") },
      { id: "e", remindAt: Date.parse("2026-10-30T10:00:00Z") }, { id: "f" },
    ];
    for (const when of q.WHEN) for (const tz of ["UTC", "Europe/Istanbul"]) {
      expect(q.pickReminders(notes, { now, tz, when })).toEqual(query.pickReminders(notes, { now, tz, when }));
    }
  });
});
