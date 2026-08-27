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

- Infinite canvas — scroll to pan, ⌘/Ctrl + scroll (or pinch) to zoom about the cursor
- Space + drag or middle-mouse drag to pan; plain left-drag draws a selection marquee
- Zoom controls bottom-right; **Fit** frames every note, so notes can never get lost off-screen
- Pan and zoom are remembered between sessions

**Pages**

- Sidebar tree of pages, nested to any depth; ☰ hides it
- **+** adds a top-level page, the row's **+** adds a sub-page, **×** deletes
  (with its notes, after a confirm)
- Double-click a page name to rename it; Enter commits, Esc cancels
- Drag notes onto a page row to move them there — the whole selection travels,
  and the dragged notes float above the sidebar rather than being clipped by it
- Each page keeps its own pan and zoom; a page opened for the first time is
  framed to fit its notes
- The open page, its expanded branches and the sidebar state all persist

**Google Drive sync**

- ☁ in the controls bar signs in with Google and syncs notes, pages and images
- Data lives in a hidden per-user Drive app folder (`drive.appdata`), not in My Drive
- Merging is per record, so two devices editing different notes both keep their work
- Deletes are tombstones, so a deletion propagates instead of the note reappearing
- Runs on sign-in, every 2 minutes, and on demand — see [docs/SYNC.md](docs/SYNC.md)

**Search**

- ⌘F or 🔍 opens search across *every* page
- Matches are highlighted, labelled with their page, and ranked with the
  current page first
- ↑ ↓ to walk results, Enter or click to jump — the note's page opens, the
  note is selected, and the view zooms to frame it

**Selecting and arranging**

- Left-drag empty canvas to marquee-select; click a note to select it
- Shift-click to add or remove a note from the selection
- ⌘A selects all, Esc clears, Delete removes the selection (locked notes survive)
- Dragging any selected note moves the whole group
- With 2+ selected, a toolbar offers align (left/centre/right, top/middle/bottom),
  distribute horizontally or vertically, and arrange into a grid

| Gesture | Action |
| --- | --- |
| Double-click empty canvas | New note |
| ⌘/Ctrl + V on the canvas | New note holding the clipboard, at the cursor |
| ⌘/Ctrl + P | The same, without the paste gesture |
| Left-drag empty canvas | Marquee select |
| Drag a note | Move it — from anywhere on an idle note |
| ⌘/Ctrl + drag a note | Move it in 24px steps, along the grid |
| Space + drag, middle-drag | Pan, from anywhere including over a note |
| Scroll / two-finger | Pan (scrolls the note you are working in) |
| ⌘/Ctrl + scroll, pinch | Zoom at cursor, wherever it is |
| Double-click note header | Fullscreen (Esc to exit) |
| Click a due reminder | Dismiss it, and stop the wiggling |

**Notes**

- Double-click empty canvas to create a note
- Drag a note from anywhere on it, resize from the corner
- Clicking a note makes it active: its header appears and the caret lands where
  you clicked. Only the active note shows one, so the canvas stays clean. Esc,
  or a click on empty canvas, steps back out
- A drag inside the active note's body selects text — its header is the handle
- The header is a popover above the active note, in the note's own colour, so
  it costs the body no room and hides the text of nothing
- Empty a note and leave it and it removes itself
- **Lock** (🔒) pins a note where it is and guards it from deletion, including
  from a bulk delete and from a group drag or an align that moves its
  neighbours. It can still be resized and edited
- **Colour** (◑) opens an 18-swatch palette; notes start with no fill
- **Fullscreen** (⤢, or double-click the header) expands a note; Esc or a
  backdrop click restores it to its exact previous position and size
- Type to format, with no toolbar in the way: `- ` starts a bullet list, `1. `
  a numbered one, `[] ` a checkbox, `# ` a heading, `> ` a quote, and a bare
  address becomes a link as you pass it
- ⌘B / ⌘I / ⌘U / ⌘⇧S for emphasis, ⌘K for a link, ⌘⌥1 / ⌘⌥2 / ⌘⌥0 for the three
  text sizes, ⌘Z / ⌘⇧Z to undo within the note
- Paste text (links survive; fonts and colours from the source do not)
- Paste images — stored as real Blobs in IndexedDB and referenced by id, not inlined as base64
- Paste with no note focused and the clipboard becomes a new note at the cursor.
  ⌘/Ctrl+P does the same by reading the clipboard directly — Chrome asks for
  permission the first time, and an empty note opens at the cursor if refused
- Drag notes onto a page in the sidebar to move them; the row fills in and says
  how many are coming before you let go
- Delete a note with its × button; its images are cleaned up too
- **Reminders** (🔔) — 15 or 40 minutes, 1, 2 or 3 hours, or a time picked by
  hand. What a note is waiting for reads on the same line as its last-edited
  time and hides with it. When the time passes the note wiggles, and keeps
  wiggling across page switches and new tabs until it is dismissed, because
  being due is worked out from the record rather than held in a timer. A note
  that has come due on a page you are not looking at makes that page's name
  wiggle instead. Clicking the reminder dismisses it
- Last-edited time per note, toggled globally with 🕘 in the controls bar
- Everything persists via IndexedDB (no 5MB ceiling like `chrome.storage.local`)

## Structure

- `manifest.json` — MV3 config, overrides the new tab page
- `newtab.html` / `css/style.css` — canvas markup and styling
- `js/boot.js` — render-blocking; applies the sidebar state before first paint
- `js/db.js` — IndexedDB open/upgrade plus small promise helpers
- `js/view.js` — view transform: pan, zoom, fit, focus, grid
- `js/note.js` — note rendering, drag, resize, lock, colour, fullscreen, dates
- `js/editor.js` — the editor: schema, input rules, and mounting it on the
  active note
- `js/vendor/tiptap.js` — the bundled editor library, built from
  `src/vendor/tiptap.entry.js` and committed so a clone loads as-is
- `js/reminders.js` — when a note is due, and which pages are holding one
- `js/selection.js` — marquee, multi-select, group move, align/distribute/grid
- `js/pages.js` — page tree, switching, drag-drop of notes between pages
- `js/search.js` — cross-page search panel
- `js/auth.js` / `js/drive.js` / `js/sync.js` / `js/syncui.js` — Google sign-in,
  Drive appdata client, the per-record merge engine, and the sync panel
- `js/store.js` — the live `id -> {note, el}` map, shared to avoid an import cycle
- `js/main.js` — wiring and boot
- `scripts/dev.js` — launches Chrome for Testing with the extension loaded
- `test/delta.test.mjs` — unit tests for the v1 Delta → HTML conversion
- `test/ui/` — the interaction suite, driven through the DevTools protocol

Everything Easy Note writes is loaded as plain ES modules
(`<script type="module">`) — no compiling, no source maps to chase. The one
exception is `js/vendor/tiptap.js`: MV3's `script-src 'self'` forbids loading
anything from a CDN, and ProseMirror ships bare imports a browser cannot
resolve, so it is bundled with esbuild:

```
npm run build     # src/vendor/tiptap.entry.js -> js/vendor/tiptap.js
```

The output is committed, so `chrome://extensions` → "Load unpacked" works
straight from a clone. `npm run package` rebuilds it first, so a release can
never ship a stale one.

### The editor

One ProseMirror view per note would not survive an infinite canvas, and it does
not have to: only one note is ever active. The editor is mounted on that note
and destroyed when it is left, so a board of 500 notes holds 500 pieces of
static HTML and at most one editor.

Notes are stored as HTML, which is what the editor reads and writes, so the
storage format did not change. The risk with a schema is what it drops: markup
it cannot model disappears the first time a note is opened. Two extensions
exist purely to stop that — a paragraph rule that also matches `div`, because
every note written before the editor is a stack of them, and an image rule that
matches `img[data-img-id]`, because the src is a per-session blob URL that is
stripped before saving. `test/ui/editor.test.mjs` opens samples of both the v1
import and the old contenteditable and checks nothing was lost.

## Tests

```
npm test        # pure functions: the v1 Delta converter
npm run test:ui # real Chrome, real pointer input: notes, navigation, pages, clipboard
```

The UI suite drives the extension over CDP with trusted input events, because
synthetic ones lie: `el.click()` skips the compatibility-event path that once
hid a delete button that never fired. It needs Chrome for Testing, the same
build `npm run dev` uses.

### Coordinates

Notes are stored in **world** coordinates. The `#world` element carries a
`translate(view.x, view.y) scale(view.zoom)` transform, and `#canvas` is the
viewport. Anything that turns a mouse position into a note position goes through
`screenToWorld()`; note drags divide their screen delta by `view.zoom`.

### IndexedDB stores

| Store    | Contents                                                                   |
| -------- | -------------------------------------------------------------------------- |
| `notes`  | `{id, pageId, x, y, width, height, html, color, z, locked, updatedAt}`       |
| `images` | `{id, blob}` — pasted images, referenced by `data-img-id`                    |
| `pages`  | `{id, name, parentId, order, collapsed}`                                     |
| `meta`   | `view:<pageId>` per page, plus `prefs`, `currentPage`, `sidebar`             |

Notes created before pages existed are adopted by the first page on load.
