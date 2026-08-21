// Links and text sizes for note bodies.
//
// Deliberately not an editor library. Bold, italic and underline already work
// because Chrome handles them natively in a contenteditable — what was missing
// was links (paste destroyed them) and any way to set emphasis.

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;
const URL_IN_TEXT = /\b(?:https?:\/\/|www\.)[^\s<>()[\]{}"']+[^\s<>()[\]{}"'.,;:!?]/gi;
// Same shape, anchored and NOT global. A /g regex carries lastIndex between
// calls, so .test() on it returns true then false for the identical string —
// which made autolinking work only every other time.
const URL_WHOLE = /^(?:https?:\/\/|www\.)[^\s<>()[\]{}"']+[^\s<>()[\]{}"'.,;:!?]$/i;

export const TEXT_STYLES = ["title", "body", "small"];

function normaliseHref(raw) {
  const href = (raw || "").trim();
  if (!href) return null;
  if (SAFE_HREF.test(href)) return href;
  // A bare www.example.com is still a link; anything else (javascript:, data:)
  // is not one we will create.
  if (/^www\./i.test(href)) return `https://${href}`;
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

/**
 * Keep links from pasted HTML, drop everything else to text.
 *
 * The old rule — force plain text — existed to stop foreign fonts and colours
 * leaking in, and it did that by destroying links too. This keeps the useful
 * half: hrefs survive, styling does not.
 */
export function pasteFragment(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const out = document.createDocumentFragment();

  const walk = (node, parent) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        parent.append(...linkifyText(child.nodeValue).childNodes);
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;

      const tag = child.tagName;
      if (tag === "A") {
        const href = normaliseHref(child.getAttribute("href"));
        const text = child.textContent;
        if (href && text) parent.append(anchor(href, text));
        else parent.append(text);
        return;
      }
      if (tag === "BR") {
        parent.append(document.createElement("br"));
        return;
      }
      if (tag === "SCRIPT" || tag === "STYLE") return;

      walk(child, parent);
      // Block-level content keeps its line break; everything else is inline.
      if (/^(P|DIV|LI|H[1-6]|TR|BLOCKQUOTE|PRE)$/.test(tag)) {
        parent.append(document.createElement("br"));
      }
    });
  };

  walk(tpl.content, out);
  return out;
}

/* ------------------------------------------------------------- typing */

// Linkify the word just finished, so typing a URL then a space makes a link.
export function autolinkAtCaret(body) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE || !body.contains(node)) return;
  if (node.parentElement.closest("a")) return; // already inside a link

  const upto = node.nodeValue.slice(0, range.startOffset);
  const match = upto.match(/(\S+)\s$/);
  if (!match) return;
  const href = normaliseHref(match[1]);
  if (!href || !URL_WHOLE.test(match[1])) return;

  const start = range.startOffset - match[0].length;
  const target = node.splitText(start);
  const tail = target.splitText(match[1].length); // begins with the space typed

  const link = anchor(href, match[1]);
  target.parentNode.replaceChild(link, target);

  // The caret belongs after the whitespace, where the user was typing. Putting
  // it straight after the link means the next word lands before that space.
  const after = document.createRange();
  after.setStart(tail, Math.min(1, tail.nodeValue.length));
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);
}

/* --------------------------------------------------------- text sizes */

function blockAt(body) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let node = sel.getRangeAt(0).startContainer;
  if (node === body) return null;
  while (node && node.parentNode !== body) node = node.parentNode;
  return node && node.nodeType === Node.ELEMENT_NODE ? node : node;
}

/** Apply one of the named sizes to the block holding the caret. */
export function setTextStyle(body, style) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;

  let block = blockAt(body);
  // Text sitting directly in the body has no block to label; give it one.
  if (!block || block.nodeType === Node.TEXT_NODE) {
    const div = document.createElement("div");
    const range = sel.getRangeAt(0);
    const offset = range.startOffset;
    const container = range.startContainer;
    if (block && block.nodeType === Node.TEXT_NODE) {
      body.replaceChild(div, block);
      div.appendChild(block);
    } else {
      body.appendChild(div);
    }
    block = div;
    const restored = document.createRange();
    try {
      restored.setStart(container, offset);
      restored.collapse(true);
      sel.removeAllRanges();
      sel.addRange(restored);
    } catch (e) {
      /* the caret was in a node we just moved; leave it where the browser put it */
    }
  }

  TEXT_STYLES.forEach((s) => block.classList.remove(`t-${s}`));
  if (style !== "body") block.classList.add(`t-${style}`);
}

/* ------------------------------------------------------- the ⌘K input */

let linkBox = null;

function closeLinkBox() {
  if (linkBox) linkBox.remove();
  linkBox = null;
}

/** Ask for a URL and wrap the selection in it. Appears only on ⌘K. */
export function promptForLink(body, onDone) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0).cloneRange();
  const selected = String(sel);
  const existing = sel.anchorNode?.parentElement?.closest?.("a[href]");

  closeLinkBox();
  linkBox = document.createElement("div");
  linkBox.className = "link-box";
  const input = document.createElement("input");
  input.type = "url";
  input.placeholder = "Paste or type a link, then Enter";
  input.value = existing ? existing.href : "";
  linkBox.appendChild(input);

  const rect = range.getBoundingClientRect();
  const anchorRect = rect.width || rect.height ? rect : body.getBoundingClientRect();
  linkBox.style.left = `${Math.min(anchorRect.left, window.innerWidth - 300)}px`;
  linkBox.style.top = `${anchorRect.bottom + 6}px`;
  document.body.appendChild(linkBox);
  input.focus();
  input.select();

  const apply = () => {
    const href = normaliseHref(input.value);
    closeLinkBox();
    if (!href) return;

    if (existing) {
      existing.href = href;
    } else {
      sel.removeAllRanges();
      sel.addRange(range);
      const link = anchor(href, selected || href);
      range.deleteContents();
      range.insertNode(link);
      const after = document.createRange();
      after.setStartAfter(link);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
    }
    body.focus();
    if (onDone) onDone();
  };

  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); apply(); }
    else if (e.key === "Escape") { e.preventDefault(); closeLinkBox(); body.focus(); }
  });
  input.addEventListener("blur", () => setTimeout(closeLinkBox, 120));
}
