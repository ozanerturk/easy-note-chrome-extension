// A note's markup as readable plain text, with no DOM — this runs in the
// service worker. Headings and paragraphs get their own lines, list items a
// "- " or "1. ", table rows their cells joined by " | ", and marks (bold,
// links, colour) simply fall away.

export const MAX_CONTENT = 50_000;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

const BLOCKS = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "ul", "ol", "table", "tr", "li"]);

export function htmlToText(html) {
  const source = String(html || "").replace(/<(script|style)\b[\s\S]*?<\/\1>|<!--[\s\S]*?-->/gi, "");
  const lists = []; // one { ordered, n } per list we are inside
  let out = "";
  let rowHasCell = false;
  let inPre = 0;

  // a line that is only a bullet is still empty: <li><p>… must not break after "- "
  const newline = () => {
    if (out && !out.endsWith("\n") && !/(^|\n)[ ]*(- |\d+\. )$/.test(out)) out += "\n";
  };

  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>|([^<]+)|</g;
  let m;
  while ((m = re.exec(source))) {
    if (m[3] !== undefined) {
      let text = decode(m[3]);
      if (!inPre) {
        text = text.replace(/\s+/g, " ");
        if (!out || out.endsWith("\n") || out.endsWith(" ")) text = text.replace(/^ /, "");
      }
      out += text;
      continue;
    }
    if (!m[2]) continue;
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();

    if (tag === "br") out += "\n";
    else if (tag === "img") out += "[image] ";
    else if (tag === "td" || tag === "th") {
      if (!closing) {
        if (rowHasCell) out = out.replace(/ +$/, "") + " | ";
        rowHasCell = true;
      }
    } else if (tag === "li") {
      if (closing) newline();
      else {
        newline();
        const list = lists[lists.length - 1];
        out += "  ".repeat(Math.max(0, lists.length - 1)) + (list?.ordered ? `${++list.n}. ` : "- ");
      }
    } else if (BLOCKS.has(tag)) {
      if (tag === "ul" || tag === "ol") {
        if (closing) lists.pop();
        else lists.push({ ordered: tag === "ol", n: 0 });
      }
      if (tag === "tr" && !closing) rowHasCell = false;
      if (tag === "pre") inPre += closing ? -1 : 1;
      newline();
    }
  }

  return out
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The text capped at MAX_CONTENT, and whether anything was cut. */
export function capped(text) {
  return text.length > MAX_CONTENT ? { content: text.slice(0, MAX_CONTENT), truncated: true } : { content: text, truncated: false };
}
