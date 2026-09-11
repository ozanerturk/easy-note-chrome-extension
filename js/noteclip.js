// Notes on the system clipboard.
//
// A copied note has to survive leaving the app, and the clipboard only carries
// text. So a copy writes the notes twice over: once as ordinary html, which is
// what turns up if you paste into an email, and once as the records themselves,
// encoded into an attribute on the wrapper around it. Pasted back onto a board
// the attribute is what gets read — colour, size, which app the note runs — and
// everywhere else it is an attribute nobody looks at.
//
// The encoding is deliberately dumb: JSON through encodeURIComponent, which
// leaves nothing that needs escaping in an attribute, and read back out with a
// regex rather than a parser so this file works anywhere, tests included.

const MARK = "easynote-notes";

/** Wrap note records as clipboard html. */
export function encodeNotes(records) {
  const body = records.map((r) => `<div>${r.html || ""}</div>`).join("");
  return `<div data-${MARK}="${encodeURIComponent(JSON.stringify(records))}">${body}</div>`;
}

/**
 * The note records inside clipboard html, or null if it came from elsewhere.
 *
 * Anything malformed reads as "not ours": a paste that cannot be trusted to be
 * a board's worth of notes is better off going down the ordinary path, where it
 * at least becomes a note with the words in it.
 */
export function decodeNotes(html) {
  const found = typeof html === "string" && html.match(new RegExp(`data-${MARK}="([^"]*)"`));
  if (!found) return null;
  try {
    const records = JSON.parse(decodeURIComponent(found[1]));
    if (!Array.isArray(records) || !records.length) return null;
    return records.filter((r) => r && typeof r === "object");
  } catch (err) {
    return null;
  }
}

/** Whether a clipboard reading is a copy of notes rather than loose content. */
export function hasNotes(content) {
  return !!content && !!decodeNotes(content.html);
}
