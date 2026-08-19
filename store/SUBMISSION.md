# Chrome Web Store submission — Easy Note 3.0.0

Upload package: **`dist/easy-note-3.0.0.zip`** (built by `npm run package`).

## Assets in this folder

| File | Where it goes |
| --- | --- |
| `screenshot-1-canvas.png` | Screenshot (1280×800) — the board and page tree |
| `screenshot-2-arrange.png` | Screenshot — multi-select and the align toolbar |
| `screenshot-3-search.png` | Screenshot — search across pages |
| `screenshot-4-sync.png` | Screenshot — the Drive sync panel |
| `promo-small-440x280.png` | Small promo tile |
| `promo-marquee-1400x560.png` | Marquee promo tile |

The 128×128 store icon is `icons/icon128.png`.

## Listing copy

**Short description** (132 max, currently 90):

> Take freeform notes the moment you open a new tab. Double-click anywhere to start writing.

**Category:** Productivity · **Language:** English

## Permission justifications

The store asks for a reason for each. These are the honest ones:

- **`identity`** — Signing in with Google is what enables optional Drive sync.
  The extension is fully usable without ever signing in.
- **Host permission `https://www.googleapis.com/`** — Reading and writing the
  user's notes in their Drive app folder.
- **Host permission `https://oauth2.googleapis.com/`** — Revoking the token
  when the user signs out.
- **New tab override** — The extension *is* the notes canvas; replacing the new
  tab page is its single purpose.

## Data disclosure

- Notes, pages and pasted images are stored **locally in IndexedDB**.
- If — and only if — the user signs in, that same data is copied to a
  **hidden per-user Drive app folder** (`drive.appdata`). It does not appear in
  My Drive, and the scope grants no access to any other file in the account.
- The extension collects **no analytics and no telemetry**. The Google
  Analytics tag lives only on the hosted release-notes web page and is stripped
  from the packaged extension, because MV3 blocks remote scripts anyway.
- Nothing is sent to any server other than Google Drive, on the user's behalf.

Answer the disclosure form as: collects **personal communications** (the note
content) only when sync is enabled; not sold; not used for anything unrelated
to the single purpose.

## Before you can submit

- [ ] **Privacy policy URL is required** because the extension requests
      `identity` and a Drive scope. There isn't one yet — this is the one hard
      blocker left.
- [ ] Confirm the OAuth client's **Item ID** is
      `hheobakelknbjicekbkmijjgcbephcef` and the **Drive API is enabled** on the
      Cloud project.
- [ ] If the consent screen is still in **Testing**, publish it, or only test
      users can sign in.
- [ ] Google will likely require **OAuth verification** for the Drive scope
      before sign-in works for the public. `drive.appdata` is narrow, which
      helps, but expect the review.

## After the store review

The published extension keeps the id `hheobakelknbjicekbkmijjgcbephcef`, so the
existing users' data is found and imported automatically, and the OAuth client
keeps working.
