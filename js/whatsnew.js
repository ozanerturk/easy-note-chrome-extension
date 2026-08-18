import { META, getOne, put } from "./db.js";

// A dismissible pill on the canvas, rather than forcing a tab open on update.
// The extension *is* the new tab, so this is already in front of the user the
// next time they open one — no need to hijack anything.

const KEY = "seenVersion";
const PAGE = "docs/release-notes.html";

function version() {
  try {
    return chrome.runtime.getManifest().version;
  } catch (e) {
    return null;
  }
}

function pageUrl() {
  try {
    return chrome.runtime.getURL(PAGE);
  } catch (e) {
    return PAGE;
  }
}

function build(current) {
  const pill = document.createElement("div");
  pill.id = "whatsnew";

  const open = document.createElement("button");
  open.className = "wn-open";
  open.type = "button";
  open.innerHTML = `<span class="wn-dot"></span>What's new in v${current}`;
  open.addEventListener("click", () => {
    window.open(pageUrl(), "_blank", "noopener");
    dismiss(current, pill);
  });

  const close = document.createElement("button");
  close.className = "wn-close";
  close.type = "button";
  close.textContent = "×";
  close.title = "Dismiss";
  close.setAttribute("aria-label", "Dismiss what's new");
  close.addEventListener("click", () => dismiss(current, pill));

  pill.append(open, close);
  document.body.appendChild(pill);
  requestAnimationFrame(() => pill.classList.add("is-in"));
}

function dismiss(current, pill) {
  put(META, { id: KEY, version: current }).catch(() => {});
  pill.classList.remove("is-in");
  setTimeout(() => pill.remove(), 200);
}

/**
 * @param {boolean} isReturningUser whether this profile already had notes —
 *   a brand new install gets no "what's new", since nothing is new to them.
 */
export async function initWhatsNew(isReturningUser) {
  const current = version();
  if (!current) return;

  const seen = await getOne(META, KEY);
  if (seen && seen.version === current) return;

  // First run: record the version silently so the pill only ever appears
  // after a genuine upgrade.
  if (!seen && !isReturningUser) {
    await put(META, { id: KEY, version: current }).catch(() => {});
    return;
  }

  build(current);
}
