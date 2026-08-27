import { NOTES, getAll } from "./db.js";
import { whenLabel } from "./note.js";
import { pages, currentPageId } from "./pages.js";

const panel = document.getElementById("search");
const input = document.getElementById("search-input");
const results = document.getElementById("search-results");

let onPick = () => {};
let matches = [];
let cursor = 0;
let debounce;

export function setSearchPickHandler(fn) {
  onPick = fn;
}

function plainText(html) {
  const div = document.createElement("div");
  div.innerHTML = html || "";
  div.querySelectorAll("img").forEach((img) => img.replaceWith("🖼 "));
  return div.textContent.replace(/\s+/g, " ").trim();
}

function snippet(text, query) {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return text.slice(0, 80);
  const from = Math.max(0, at - 24);
  return (from ? "…" : "") + text.slice(from, from + 90);
}

function highlight(text, query) {
  const frag = document.createDocumentFragment();
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let i = 0;
  while (true) {
    const at = lower.indexOf(q, i);
    if (at < 0 || !q) break;
    frag.append(text.slice(i, at));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(at, at + q.length);
    frag.append(mark);
    i = at + q.length;
  }
  frag.append(text.slice(i));
  return frag;
}

function paint(query) {
  results.textContent = "";
  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "search-empty";
    empty.textContent = query ? "No matching notes" : "No notes yet";
    results.appendChild(empty);
    return;
  }

  if (!query) {
    const label = document.createElement("div");
    label.className = "search-label";
    label.textContent = "Recently edited";
    results.appendChild(label);
  }

  matches.forEach((m, i) => {
    const row = document.createElement("button");
    row.className = "search-row";
    if (i === cursor) row.classList.add("is-active");

    const swatch = document.createElement("span");
    swatch.className = "search-swatch";
    // An unfilled note has no colour to show; a blank swatch would just look
    // like a rendering fault.
    swatch.style.background = m.color && m.color !== "transparent" ? m.color : "#eee";

    const text = document.createElement("span");
    text.className = "search-text";
    text.appendChild(highlight(snippet(m.text, query), query));
    // The snippet is clipped; the title carries enough of the note to identify it.
    text.title = m.text.length > 300 ? m.text.slice(0, 300) + "…" : m.text;

    const page = document.createElement("span");
    page.className = "search-page";
    page.textContent = pages.get(m.pageId)?.name || "";

    // The same wording as the line under a note, so "3h ago" means the same
    // thing wherever it is read.
    const when = document.createElement("span");
    when.className = "search-when";
    when.textContent = m.when;

    row.append(swatch, text, page, when);
    row.addEventListener("click", () => choose(i));
    results.appendChild(row);
  });
}

function choose(index) {
  const match = matches[index];
  if (!match) return;
  close();
  onPick(match.id, match.pageId);
}

const RECENT_COUNT = 5;

async function run(query) {
  const records = await getAll(NOTES);
  const q = query.trim().toLowerCase();
  const live = records
    .filter((r) => !r.deleted)
    .map((r) => ({
      id: r.id,
      pageId: r.pageId,
      color: r.color,
      text: plainText(r.html),
      at: r.editedAt || r.updatedAt || 0,
      when: whenLabel(r),
    }))
    .filter((r) => r.text);

  matches = !q
    ? // An empty box offers the notes you touched last, so opening search is
      // useful before typing anything.
      live.sort((a, b) => b.at - a.at).slice(0, RECENT_COUNT)
    : live
        .filter((r) => r.text.toLowerCase().includes(q))
        // notes on the page you are looking at come first
        .sort((a, b) => (a.pageId === currentPageId ? -1 : 0) - (b.pageId === currentPageId ? -1 : 0))
        .slice(0, 40);
  cursor = 0;
  paint(query);
}

export function open() {
  panel.classList.add("is-open");
  input.value = "";
  matches = [];
  paint("");
  input.focus();
  run(""); // fills in the recent list
}

export function close() {
  panel.classList.remove("is-open");
  input.blur();
}

export function isOpen() {
  return panel.classList.contains("is-open");
}

export function initSearch() {
  document.getElementById("open-search").addEventListener("click", open);

  input.addEventListener("input", () => {
    clearTimeout(debounce);
    const q = input.value;
    debounce = setTimeout(() => run(q), 120);
  });

  input.addEventListener("keydown", (e) => {
    e.stopPropagation(); // canvas shortcuts must not fire while typing
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      cursor = Math.min(cursor + 1, matches.length - 1);
      paint(input.value);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      cursor = Math.max(cursor - 1, 0);
      paint(input.value);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(cursor);
    }
  });

  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      open();
    }
  });

  document.addEventListener("pointerdown", (e) => {
    if (isOpen() && !e.target.closest("#search") && !e.target.closest("#open-search")) close();
  });
}
