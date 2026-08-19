Your new tab is a notes canvas. v3 is a ground-up rewrite that keeps the two-second capture and adds room to organise.

**[What's new — guided tour and how-tos](https://ozanerturk.github.io/easy-note-chrome-extension/release-notes.html)**

## Google Drive sync

Sign in with Google and your notes, pages and pasted images follow you between machines.

- Data lives in a **hidden per-user app folder**, so it never appears in My Drive and the extension cannot see any other file in your account.
- **Merging is per note, not per board** — two machines editing different notes both keep their work.
- **Deletes propagate** instead of the note reappearing from your other laptop.

## Infinite canvas

Scroll to pan, ⌘/Ctrl-scroll or pinch to zoom about the cursor, and **Fit** to bring every note back on screen.

## Pages

A sidebar tree, nested as deep as you like. Drag notes onto a page to move them — the whole selection travels. Each page remembers its own pan and zoom.

## Lock notes

Locks a note against deletion while leaving it movable and editable.

## Also

- Multi-select with align, distribute and grid
- Search across every page; an empty box lists your five most recent notes
- Paste text (cleaned of foreign styling) and images (stored as real blobs, not base64)
- Per-note colours, fullscreen editing, and optional last-edited times

## Upgrading from v1

Notes from the published v1 are **imported automatically on first run**, keeping headings, lists, links, bold, italic, underline, strikethrough and note colours.

v1's database is opened **read-only and never modified**, so rolling back loses nothing. Verified against the real published extension rather than against its source — see [`docs/MIGRATION.md`](docs/MIGRATION.md).

## Known limits

- Sync compares wall-clock timestamps, so a badly wrong clock can win a conflict it shouldn't.
- Two devices syncing within the same few seconds can drop one update.
- Sync runs every couple of minutes and on demand. It is built for one person across several machines, not live collaboration.

---

The previous published version is preserved at the [`v1.3.1-published`](https://github.com/ozanerturk/easy-note-chrome-extension/tree/v1.3.1-published) tag.
[Privacy policy](https://ozanerturk.github.io/easy-note-chrome-extension/privacy.html) · [Chrome Web Store](https://chromewebstore.google.com/detail/easy-note/hheobakelknbjicekbkmijjgcbephcef)
