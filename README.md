# Easy Note

A Chrome extension that replaces the new tab page with a freeform note-taking canvas — double-click anywhere to drop a note, OneNote-style. This is a fresh iteration on the previously published [Easy Note](https://chromewebstore.google.com/detail/easy-note/hheobakelknbjicekbkmijjgcbephcef) extension.

## Quick start

```bash
node scripts/dev.js
```

Launches Chrome with the extension auto-loaded. Open a new tab and start double-clicking.

## Manual load

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select this folder
4. Open a new tab

## Current features

- Double-click empty canvas to create a note
- Drag notes by their header, resize from the corner
- Notes persist via IndexedDB (no storage-quota ceiling like `chrome.storage.local`'s default 5MB)
- Delete a note with its × button

## Structure

- `manifest.json` — MV3 config, overrides the new tab page
- `newtab.html` / `css/style.css` — canvas markup and styling
- `js/notes.js` — note CRUD, drag, resize, persistence
