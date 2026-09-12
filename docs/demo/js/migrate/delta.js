// Quill Delta -> HTML.
//
// Only what the published v1 could actually produce is supported. Pure and
// DOM-free so it can be unit tested directly.
//
// The subtlety: block formatting (header, list, blockquote, code-block) is not
// carried on the text it applies to. It rides on the op holding that line's
// trailing newline:
//
//   {insert: "Heading here"}
//   {attributes: {header: 2}, insert: "\n"}   <- the h2 lives here
//
// So inline runs are buffered, and a line is only closed — and its wrapper
// chosen — when a newline is reached.

const INLINE = [
  ["code", (s) => `<code>${s}</code>`],
  ["strike", (s) => `<s>${s}</s>`],
  ["underline", (s) => `<u>${s}</u>`],
  ["italic", (s) => `<em>${s}</em>`],
  ["bold", (s) => `<strong>${s}</strong>`],
];

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineHtml(text, attrs = {}) {
  let html = escapeHtml(text);
  for (const [key, wrap] of INLINE) if (attrs[key]) html = wrap(html);
  if (attrs.link) {
    const href = escapeHtml(attrs.link);
    html = `<a href="${href}" target="_blank" rel="noopener">${html}</a>`;
  }
  return html;
}

function listTag(kind) {
  return kind === "ordered" ? "ol" : "ul";
}

export function deltaToHtml(delta) {
  // Accept {ops: [...]} — which is what v1 actually stored — or a bare array.
  const ops = Array.isArray(delta) ? delta : (delta && delta.ops) || [];

  const out = [];
  let line = "";
  let openList = null;

  const closeList = () => {
    if (openList) {
      out.push(`</${listTag(openList)}>`);
      openList = null;
    }
  };

  const flushLine = (attrs = {}) => {
    const content = line;
    line = "";

    if (attrs.list) {
      const tag = listTag(attrs.list);
      if (openList !== attrs.list) {
        closeList();
        out.push(`<${tag}>`);
        openList = attrs.list;
      }
      out.push(`<li>${content}</li>`);
      return;
    }

    closeList();

    if (attrs.header) {
      const level = Math.min(6, Math.max(1, Number(attrs.header) || 1));
      out.push(`<h${level}>${content}</h${level}>`);
    } else if (attrs.blockquote) {
      out.push(`<blockquote>${content}</blockquote>`);
    } else if (attrs["code-block"]) {
      out.push(`<pre>${content}</pre>`);
    } else if (content) {
      out.push(`<div>${content}</div>`);
    } else {
      // A bare newline is a blank line, which contentEditable writes this way.
      out.push("<div><br></div>");
    }
  };

  for (const op of ops) {
    const insert = op && op.insert;
    if (typeof insert !== "string") continue; // images and other embeds: v1 had none

    const parts = insert.split("\n");
    parts.forEach((part, i) => {
      if (part) line += inlineHtml(part, op.attributes);
      // every split point except the last represents a real newline
      if (i < parts.length - 1) flushLine(op.attributes);
    });
  }

  if (line) flushLine({});
  closeList();

  return out.join("");
}

export function deltaToPlainText(delta) {
  const ops = Array.isArray(delta) ? delta : (delta && delta.ops) || [];
  return ops
    .map((op) => (typeof op.insert === "string" ? op.insert : ""))
    .join("")
    .trim();
}
