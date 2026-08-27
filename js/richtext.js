// Turning loose text into links, and asking for one.
//
// The editor in js/editor.js parses everything that arrives as markup. Plain
// text has no markup to parse: autolinking only happens as you type, so text
// pasted in whole needs its addresses found for it.

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;
const URL_IN_TEXT = /\b(?:https?:\/\/|www\.)[^\s<>()[\]{}"']+[^\s<>()[\]{}"'.,;:!?]/gi;

function normaliseHref(raw) {
  const href = (raw || "").trim();
  if (!href) return null;
  if (SAFE_HREF.test(href)) return href;
  // Anything carrying another scheme — javascript:, data: — is not a link we
  // will make, whoever asked for it.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  // Typed by hand, "example.org" means a link. Autodetection in running text
  // stays stricter than this; here someone has said so explicitly.
  if (/^[^\s/?#]+\.[^\s]*$/.test(href)) return `https://${href}`;
  return null;
}

function anchor(href, text) {
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = text;
  return a;
}

/** Turn bare URLs inside a plain string into real links. */
export function linkifyText(text) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const href = normaliseHref(match[0]);
    if (!href) continue;
    if (match.index > last) frag.append(text.slice(last, match.index));
    frag.append(anchor(href, match[0]));
    last = match.index + match[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

/* ------------------------------------------------------- the ⌘K input */

let linkBox = null;

function closeLinkBox() {
  if (linkBox) linkBox.remove();
  linkBox = null;
}

/**
 * Ask for a URL. Appears only on ⌘K, and knows nothing about the editor —
 * `onApply` is handed a safe href, or an empty string to take the link off.
 */
export function promptForLink(near, currentHref, onApply) {
  closeLinkBox();
  linkBox = document.createElement("div");
  linkBox.className = "link-box";

  const input = document.createElement("input");
  input.type = "url";
  input.placeholder = "Paste or type a link, then Enter";
  input.value = currentHref || "";
  linkBox.appendChild(input);

  // Over the caret if there is one to measure, otherwise under the note.
  const selection = window.getSelection();
  const caret = selection && selection.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
  const box = caret && (caret.width || caret.height) ? caret : near.getBoundingClientRect();
  linkBox.style.left = `${Math.min(box.left, window.innerWidth - 300)}px`;
  linkBox.style.top = `${box.bottom + 6}px`;

  document.body.appendChild(linkBox);
  input.focus();
  input.select();

  const apply = () => {
    const raw = input.value.trim();
    closeLinkBox();
    onApply(raw ? normaliseHref(raw) || "" : "");
  };

  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      apply();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeLinkBox();
    }
  });
  input.addEventListener("blur", () => setTimeout(closeLinkBox, 120));
}
