# Easy Note

A Chrome extension that replaces the new tab page with a freeform note-taking canvas — double-click anywhere to drop a note, OneNote-style. This is a fresh iteration on the previously published [Easy Note](https://chromewebstore.google.com/detail/easy-note/hheobakelknbjicekbkmijjgcbephcef) extension.

## Quick start

One-time setup — download Chrome for Testing:

```bash
npm install
npx @puppeteer/browsers install chrome@stable --path "$PWD/.chrome"
```

Then launch:

```bash
npm run dev
```

This opens Chrome for Testing with the extension auto-loaded and a persistent
`.dev-profile`, so notes survive between runs.

> Chrome for Testing is required because branded Chrome removed `--load-extension`
> in v137, and removed the `--disable-features=DisableLoadExtensionCommandLineSwitch`
> workaround in v142. Unpacked extensions can no longer be auto-loaded from the
> command line in regular Chrome.

## Manual load (regular Chrome)

1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" and select this folder
4. Open a new tab

## Current features

**Canvas**

- Infinite canvas — drag empty space to pan, scroll to pan, ⌘/Ctrl + scroll (or pinch) to zoom
- Zoom controls bottom-right; **Fit** frames every note, so notes can never get lost off-screen
- Pan and zoom are remembered between sessions

**Notes**

- Double-click empty canvas to create a note
- Drag notes by their header, resize from the corner
- Header controls appear only on hover, so the canvas stays clean
- **Lock** (🔒) guards a note from deletion — it can still be moved and resized
- **Colour** (◑) switches between eight palette colours
- **Fullscreen** (⤢, or double-click the header) expands a note; Esc or a
  backdrop click restores it to its exact previous position and size
- Paste text (inserted as plain text, so foreign markup and styling never leak in)
- Paste images — stored as real Blobs in IndexedDB and referenced by id, not inlined as base64
- Delete a note with its × button; its images are cleaned up too
- Last-edited time per note, toggled globally with 🕘 in the controls bar
- Everything persists via IndexedDB (no 5MB ceiling like `chrome.storage.local`)

## Structure

- `manifest.json` — MV3 config, overrides the new tab page
- `newtab.html` / `css/style.css` — canvas markup and styling
- `js/db.js` — IndexedDB open/upgrade plus small promise helpers
- `js/view.js` — view transform: pan, zoom, fit, focus, grid
- `js/note.js` — note rendering, drag, resize, paste, lock, colour, fullscreen, dates
- `js/main.js` — wiring and boot
- `scripts/dev.js` — launches Chrome for Testing with the extension loaded

Loaded as ES modules (`<script type="module">`), so there is still no build step.

### Coordinates

Notes are stored in **world** coordinates. The `#world` element carries a
`translate(view.x, view.y) scale(view.zoom)` transform, and `#canvas` is the
viewport. Anything that turns a mouse position into a note position goes through
`screenToWorld()`; note drags divide their screen delta by `view.zoom`.

### IndexedDB stores

| Store    | Contents                                                  |
| -------- | --------------------------------------------------------- |
| `notes`  | `{id, x, y, width, height, html, color, z}`                 |
| `images` | `{id, blob}` — pasted images, referenced by `data-img-id`   |
| `meta`   | `{id: 'view', x, y, zoom}` — persisted viewport             |
