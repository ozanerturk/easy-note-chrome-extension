// The three tools. Each reads or writes through the same modules the board
// uses; none of them touches the DOM.

import { openOnce, getAll, getOne, NOTES, PAGES, META, TRAY_ID } from "../db.js";
import { saveText } from "../clip/save.js";
import { imgIdsIn, ocrMap, pathFrom, snippetAround, titleOf, pickReminders, localString } from "../notes/query.js";
import { htmlToText, capped } from "./text.js";

export class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Same rule as the board's search and sidebar: tombstones and the capture tray
// are not notes anyone is looking for. A note that was locked in an earlier
// version stays private: a lock hid a note's content, so it is never shared.
const readable = (note) => note && !note.deleted && note.pageId !== TRAY_ID && !note.locked;

const stamp = (note) => note.editedAt || note.updatedAt || 0;

export async function searchNotes({ query, limit }) {
  await openOnce();
  const [notes, pageRows, meta] = await Promise.all([getAll(NOTES), getAll(PAGES), getAll(META)]);
  const pages = new Map(pageRows.map((p) => [p.id, p]));
  const ocr = ocrMap(meta);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  const hits = [];
  for (const note of notes) {
    if (!readable(note)) continue;
    const words = imgIdsIn(note.html).map((id) => ocr.get(id)).filter(Boolean).join(" ");
    const text = [htmlToText(note.html), words].filter(Boolean).join("\n");
    const lower = text.toLowerCase();
    if (!terms.every((t) => lower.includes(t))) continue;
    const title = titleOf(text);
    const inTitle = terms.filter((t) => title.toLowerCase().includes(t)).length;
    hits.push({ note, text, title, inTitle });
  }
  // a word in the first line beats a word buried lower down; then newest
  hits.sort((a, b) => b.inTitle - a.inTitle || stamp(b.note) - stamp(a.note));

  return hits.slice(0, limit).map(({ note, text, title }) => ({
    id: note.id,
    title,
    snippet: snippetAround(text, terms, 300),
    pagePath: pathFrom(pages, note.pageId),
    updatedAt: stamp(note),
  }));
}

export async function getNote({ id }) {
  await openOnce();
  const note = await getOne(NOTES, id);
  if (!readable(note)) throw new ToolError("NOT_FOUND", "Note not found");
  const pages = new Map((await getAll(PAGES)).map((p) => [p.id, p]));
  const text = htmlToText(note.html);
  return {
    id: note.id,
    title: titleOf(text),
    pagePath: pathFrom(pages, note.pageId),
    ...capped(text),
    updatedAt: stamp(note),
  };
}

export async function capture({ text, sourceUrl, title }) {
  const note = await saveText({ text, sourceUrl, title });
  return { id: note.id, location: "Capture Tray" };
}

export async function listReminders({ when, timezone, limit }) {
  await openOnce();
  const [notes, pageRows] = await Promise.all([getAll(NOTES), getAll(PAGES)]);
  const pages = new Map(pageRows.map((p) => [p.id, p]));
  const now = Date.now();
  return pickReminders(notes.filter(readable), { now, tz: timezone, when })
    .slice(0, limit)
    .map(({ note, due }) => {
      const text = htmlToText(note.html);
      return {
        id: note.id,
        title: titleOf(text),
        snippet: snippetAround(text, [], 300),
        pagePath: pathFrom(pages, note.pageId),
        remindAt: new Date(note.remindAt).toISOString(),
        remindAtLocal: localString(note.remindAt, timezone),
        due,
        updatedAt: stamp(note),
      };
    });
}

export const handlers = { search_notes: searchNotes, get_note: getNote, capture, list_reminders: listReminders };
