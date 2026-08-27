# Chrome Web Store submission — Easy Note 3.1.0

Upload package: **`dist/easy-note-3.1.0.zip`** (built by `npm run package`).

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

The extension now requests **one** permission and **no host permissions**.
Host permissions were removed after verifying that Google's API endpoints
answer cross-origin requests from an extension page without them — the Drive
list, upload, userinfo and revoke calls all succeed, and a real authenticated
sync round trip completes. That also avoids the "in-depth review" delay the
store warns about for host permissions.

### `identity` — paste this

```
Easy Note stores notes locally. "identity" is used only to let a user
optionally sign in with their own Google account so their notes can sync
between their own computers, which is part of the extension's single purpose
as a note-taking tool.

chrome.identity.getAuthToken obtains a token for two narrow scopes:
drive.appdata, so notes can be saved to a hidden application folder in the
user's own Google Drive, and userinfo.email, so the sync panel can show which
account is signed in.

Nothing is sent anywhere other than the user's own Google Drive. There is no
developer server, no analytics and no tracking. The extension is fully usable
without ever signing in, and signing out revokes the token.
```

### Host permissions — none requested

If a field still asks, the honest answer is:

```
This extension requests no host permissions. It calls Google's Drive and
OAuth endpoints from the extension page using standard cross-origin requests,
which Google's APIs allow, so no host access is required.
```

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

- [ ] **Turn on GitHub Pages** — Settings → Pages → deploy from branch
      `master`, folder `/docs`. That publishes three pages:

      | URL | Use |
      | --- | --- |
      | `…github.io/easy-note-chrome-extension/` | Landing page |
      | `…/privacy.html` | **Privacy policy URL for the store form** |
      | `…/release-notes.html` | What's new |

      Full privacy URL to paste into the listing:

      ```
      https://ozanerturk.github.io/easy-note-chrome-extension/privacy.html
      ```
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
