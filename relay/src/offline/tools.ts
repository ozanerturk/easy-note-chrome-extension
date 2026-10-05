import type { SyncedDoc, Note } from "../drive/reader.js";
import { capped, htmlToText } from "../shared/text.js";
import { pathFrom, pickReminders, localString, snippetAround, titleOf, type Page, type When } from "../shared/query.js";

// The same three reads the extension answers from its own database, answered
// from a note document read out of Drive. Written to give the same answers as
// js/bridge/handlers.js — test/parity.test.ts checks that they do. One
// difference is unavoidable: the text read out of pictures is cached on the
// device only, so it is not here.

const TRAY_ID = "capture-tray";

export class OfflineError extends Error {
  constructor(public code: "NOT_FOUND", message: string) {
    super(message);
  }
}

const readable = (n: Note | undefined): n is Note => !!n && !n.deleted && n.pageId !== TRAY_ID;
const stamp = (n: Note) => n.editedAt || n.updatedAt || 0;
const pageMap = (doc: SyncedDoc) => new Map<string, Page>(doc.pages.map((p) => [p.id, p]));

export function searchNotes(doc: SyncedDoc, { query, limit }: { query: string; limit: number }) {
  const pages = pageMap(doc);
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  const hits: { note: Note; text: string; title: string; inTitle: number }[] = [];
  for (const note of doc.notes) {
    if (!readable(note)) continue;
    const text = htmlToText(note.html);
    const lower = text.toLowerCase();
    if (!terms.every((t) => lower.includes(t))) continue;
    const title = titleOf(text);
    hits.push({ note, text, title, inTitle: terms.filter((t) => title.toLowerCase().includes(t)).length });
  }
  hits.sort((a, b) => b.inTitle - a.inTitle || stamp(b.note) - stamp(a.note));

  return hits.slice(0, limit).map(({ note, text, title }) => ({
    id: note.id,
    title,
    snippet: snippetAround(text, terms, 300),
    pagePath: pathFrom(pageMap(doc), note.pageId ?? ""),
    updatedAt: stamp(note),
  }));
}

export function getNote(doc: SyncedDoc, { id }: { id: string }) {
  const note = doc.notes.find((n) => n.id === id);
  if (!readable(note)) throw new OfflineError("NOT_FOUND", "Note not found");
  const text = htmlToText(note.html);
  return {
    id: note.id,
    title: titleOf(text),
    pagePath: pathFrom(pageMap(doc), note.pageId ?? ""),
    ...capped(text),
    updatedAt: stamp(note),
  };
}

export function listReminders(doc: SyncedDoc, { when, timezone, limit, now = Date.now() }: { when: When; timezone: string; limit: number; now?: number }) {
  const pages = pageMap(doc);
  return pickReminders(doc.notes.filter(readable), { now, tz: timezone, when })
    .slice(0, limit)
    .map(({ note, due }) => {
      const text = htmlToText(note.html);
      return {
        id: note.id,
        title: titleOf(text),
        snippet: snippetAround(text, [], 300),
        pagePath: pathFrom(pages, note.pageId ?? ""),
        remindAt: new Date(note.remindAt!).toISOString(),
        remindAtLocal: localString(note.remindAt!, timezone),
        due,
        updatedAt: stamp(note),
      };
    });
}
