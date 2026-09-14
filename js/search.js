import { NOTES, META, TRAY_ID, getAll } from "./db.js";
import { whenLabel, plainText } from "./note.js";
import { pages } from "./pages.js";
import { markUsed } from "./tips.js";
import { remindLabel } from "./reminders.js";

// Search is also the way to look over everything: open it with nothing typed
// and it lists every note, in whichever order the tabs under the box say.
// Typing narrows that list and keeps its order, so "reminders containing
// dentist" is a tab and a word, not a feature of its own.

const panel = document.getElementById("search");
const input = document.getElementById("search-input");
const results = document.getElementById("search-results");
const filters = document.getElementById("search-filters");

let onPick = () => {};
let matches = [];
let cursor = 0;
let debounce;

const SORTS = ["recent", "reminders", "az", "za"];
// Recent, every time it opens. What you did last time is not a setting.
let sort = "recent";

const EMPTY = {
  recent: "No notes yet",
  reminders: "No reminders set",
  az: "No notes yet",
  za: "No notes yet",
};

export function setSearchPickHandler(fn) {
  onPick = fn;
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
  filters.querySelectorAll("[data-sort]").forEach((tab) => {
    const on = tab.dataset.sort === sort;
    tab.classList.toggle("is-on", on);
    tab.setAttribute("aria-selected", String(on));
  });

  if (!matches.length) {
    const empty = document.createElement("div");
    empty.className = "search-empty";
    empty.textContent = query ? "No matching notes" : EMPTY[sort];
    results.appendChild(empty);
    return;
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
    if (sort === "reminders") {
      // Here the time that matters is the one it is waiting for.
      when.textContent = `🔔 ${remindLabel(m.remindAt)}`;
      when.classList.toggle("is-due", m.remindAt <= Date.now());
    } else {
      when.textContent = m.when;
    }

    row.append(swatch, text, page, when);
    row.addEventListener("click", () => choose(i));
    results.appendChild(row);
    // The list is long now; the arrow keys must not walk off the bottom of it.
    if (i === cursor) row.scrollIntoView({ block: "nearest" });
  });
}

function choose(index) {
  const match = matches[index];
  if (!match) return;
  close();
  onPick(match.id, match.pageId);
}

// Enough to look over a board at a glance, not so many that painting the list
// is the slow part of opening it.
const LIMIT = 200;

const byText = (a, b) => a.text.localeCompare(b.text, undefined, { sensitivity: "base", numeric: true });

const ORDER = {
  recent: (a, b) => b.at - a.at,
  // Soonest first, which puts whatever is already due at the top.
  reminders: (a, b) => a.remindAt - b.remindAt,
  az: byText,
  za: (a, b) => byText(b, a),
};

// A picture's words, once read, are stored once — see ocr.js — so folding
// them in here costs one extra read of `meta`, never a recognition pass.
const imgIdsIn = (html) => [...String(html || "").matchAll(/data-img-id="([^"]+)"/g)].map((m) => m[1]);

async function ocrTextByImage() {
  const rows = await getAll(META);
  const byId = new Map();
  rows.forEach((r) => {
    if (typeof r.id === "string" && r.id.startsWith("ocr:") && r.text) byId.set(r.id.slice(4), r.text);
  });
  return byId;
}

async function run(query) {
  const [records, ocrByImage] = await Promise.all([getAll(NOTES), ocrTextByImage()]);
  const q = query.trim().toLowerCase();
  const live = records
    // Captures are excluded: an unfiled one is already on screen in the tray,
    // and search's job is to take you to a note on a board — which a capture,
    // by definition, is not on yet. A locked note hides its own content on
    // purpose, and a search hit would show that content in the results list —
    // so it is left out entirely while locked, the same as if it said nothing.
    .filter((r) => !r.deleted && r.pageId !== TRAY_ID && !r.locked)
    .map((r) => {
      const ocr = imgIdsIn(r.html)
        .map((id) => ocrByImage.get(id))
        .filter(Boolean)
        .join(" ");
      return {
        id: r.id,
        pageId: r.pageId,
        color: r.color,
        text: ocr ? `${plainText(r.html)} ${ocr}`.trim() : plainText(r.html),
        at: r.editedAt || r.updatedAt || 0,
        when: whenLabel(r),
        remindAt: r.remindAt || 0,
      };
    })
    .filter((r) => r.text);

  matches = live
    .filter((r) => sort !== "reminders" || r.remindAt)
    .filter((r) => !q || r.text.toLowerCase().includes(q))
    .sort(ORDER[sort])
    .slice(0, LIMIT);
  cursor = 0;
  paint(query);
}

function setSort(next) {
  if (!SORTS.includes(next) || next === sort) return;
  sort = next;
  run(input.value);
}

export function open() {
  markUsed("search");
  panel.classList.add("is-open");
  sort = "recent";
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

  filters.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-sort]");
    if (!tab) return;
    setSort(tab.dataset.sort);
    input.focus(); // so typing carries straight on
  });

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
    } else if (e.key === "Tab") {
      // The tabs, from the keyboard, without leaving the box.
      e.preventDefault();
      const step = e.shiftKey ? -1 : 1;
      setSort(SORTS[(SORTS.indexOf(sort) + step + SORTS.length) % SORTS.length]);
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
