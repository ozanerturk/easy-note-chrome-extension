import { deltaToHtml, deltaToPlainText } from "../js/migrate/delta.js";

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (got === want) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       got:  ${got}\n       want: ${want}`); }
};

console.log("Delta -> HTML");

// the two real Deltas captured from published v1.3.1
eq("real v1 note: bold + italic runs",
  deltaToHtml({ops:[
    {insert:"Plain line\n"},
    {attributes:{bold:true},insert:"bold bit plus "},
    {attributes:{italic:true,bold:true},insert:"italic bit"},
    {insert:"\n"}
  ]}),
  "<div>Plain line</div><div><strong>bold bit plus </strong><strong><em>italic bit</em></strong></div>");

eq("real v1 note: header + bullets + link",
  deltaToHtml({ops:[
    {insert:"Heading here"},
    {attributes:{header:2},insert:"\n"},
    {insert:"first"},
    {attributes:{list:"bullet"},insert:"\n"},
    {insert:"second"},
    {attributes:{list:"bullet"},insert:"\n"},
    {attributes:{link:"https://example.com"},insert:"a link"},
    {insert:"\n"}
  ]}),
  '<h2>Heading here</h2><ul><li>first</li><li>second</li></ul><div><a href="https://example.com" target="_blank" rel="noopener">a link</a></div>');

eq("bare array delta also accepted",
  deltaToHtml([{insert:"hi\n"}]), "<div>hi</div>");

eq("ordered list groups into one <ol>",
  deltaToHtml({ops:[
    {insert:"one"},{attributes:{list:"ordered"},insert:"\n"},
    {insert:"two"},{attributes:{list:"ordered"},insert:"\n"}
  ]}),
  "<ol><li>one</li><li>two</li></ol>");

eq("switching list type closes the previous list",
  deltaToHtml({ops:[
    {insert:"a"},{attributes:{list:"bullet"},insert:"\n"},
    {insert:"b"},{attributes:{list:"ordered"},insert:"\n"}
  ]}),
  "<ul><li>a</li></ul><ol><li>b</li></ol>");

eq("text after a list closes the list",
  deltaToHtml({ops:[
    {insert:"a"},{attributes:{list:"bullet"},insert:"\n"},
    {insert:"after\n"}
  ]}),
  "<ul><li>a</li></ul><div>after</div>");

eq("blockquote and code-block",
  deltaToHtml({ops:[
    {insert:"quoted"},{attributes:{blockquote:true},insert:"\n"},
    {insert:"coded"},{attributes:{"code-block":true},insert:"\n"}
  ]}),
  "<blockquote>quoted</blockquote><pre>coded</pre>");

eq("underline and strike",
  deltaToHtml({ops:[
    {attributes:{underline:true},insert:"u"},
    {attributes:{strike:true},insert:"s"},
    {insert:"\n"}
  ]}),
  "<div><u>u</u><s>s</s></div>");

eq("blank line becomes an empty div",
  deltaToHtml({ops:[{insert:"a\n\nb\n"}]}),
  "<div>a</div><div><br></div><div>b</div>");

eq("html in note text is escaped, not injected",
  deltaToHtml({ops:[{insert:'<script>alert(1)</script> & "x"\n'}]}),
  "<div>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;</div>");

eq("link href is escaped",
  deltaToHtml({ops:[{attributes:{link:'" onmouseover="evil()'},insert:"x"},{insert:"\n"}]}),
  '<div><a href="&quot; onmouseover=&quot;evil()" target="_blank" rel="noopener">x</a></div>');

eq("header level is clamped",
  deltaToHtml({ops:[{insert:"h"},{attributes:{header:99},insert:"\n"}]}),
  "<h6>h</h6>");

eq("non-string embeds are skipped",
  deltaToHtml({ops:[{insert:{image:"data:..."}},{insert:"after\n"}]}),
  "<div>after</div>");

eq("trailing text with no newline still emits",
  deltaToHtml({ops:[{insert:"no trailing newline"}]}),
  "<div>no trailing newline</div>");

eq("empty delta", deltaToHtml({ops:[]}), "");
eq("undefined delta", deltaToHtml(undefined), "");

console.log("\nplain text extraction");
eq("plain text", deltaToPlainText({ops:[{insert:"a"},{attributes:{bold:true},insert:"b"},{insert:"\n"}]}), "ab");
eq("empty note detected", deltaToPlainText({ops:[{insert:"\n"}]}), "");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
