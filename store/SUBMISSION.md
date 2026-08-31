# Chrome Web Store submission — Easy Note 3.2.0

Upload package: **`dist/easy-note-3.2.0.zip`** (built by `npm run package`).

## Assets in this folder

| File | Where it goes |
| --- | --- |
| `screenshot-1-canvas.png` | Screenshot (1280×800) — the board and page tree |
| `screenshot-2-clip.png` | Screenshot — clipping a region out of a web page |
| `screenshot-3-tray.png` | Screenshot — the Capture tray holding what was clipped |
| `screenshot-4-dark.png` | Screenshot — the same board in dark mode |
| `screenshot-5-search.png` | Screenshot — search across every page |

Upload them in that order. The store shows five at most, and the first is the
one most people judge the extension on, so the board leads and the clipper —
the reason to install 3.2 — comes straight after it.

All five are shot from the real extension at 1280×800 by
`npm run screenshots` (scripts/screenshots.mjs), not mocked up.
| `promo-small-440x280.png` | Small promo tile |
| `promo-marquee-1400x560.png` | Marquee promo tile |

The 128×128 store icon is `icons/icon128.png`.

## Listing copy

**Short description** (132 max, currently 90):

> Take freeform notes the moment you open a new tab. Double-click anywhere to start writing.

**Category:** Productivity · **Language:** English

## Permission justifications

The extension requests **four** permissions and **no host permissions**.

Host permissions were never added: Google's API endpoints answer cross-origin
requests from an extension page without them — the Drive list, upload,
userinfo and revoke calls all succeed, and a real authenticated sync round trip
completes. The screen clipper added in 3.2 was deliberately built on
`activeTab` for the same reason, so the extension still avoids the "in-depth
review" path the store warns about for broad host access.

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

### `activeTab` — paste this

```
Used by the screen clipper. When the user presses the extension's toolbar
icon, its keyboard shortcut, or its right-click menu item, Easy Note draws a
selection overlay on that one page so the user can drag a box around a region
and save it as a note.

activeTab grants access to a single tab, only in response to that explicit
user action, and it expires when the user navigates away. The extension has no
standing access to any page and reads nothing from a page it was not invoked
on. It never inspects page content — it captures the visible pixels of the
region the user drew, and nothing else.
```

### `scripting` — paste this

```
Used together with activeTab to inject the clipper's selection overlay into
the current page on demand. No content script is registered to run
automatically on any site; the overlay is injected only after the user asks
for a clip, and it removes itself when the clip is saved or cancelled.
```

### `contextMenus` — paste this

```
Adds a single "Clip to Easy Note" item to the page right-click menu, as one of
the three ways to start a screen clip. It creates no other menu items and
reads nothing from the page.
```

### Host permissions — none requested

If a field still asks, the honest answer is:

```
This extension requests no host permissions. It calls Google's Drive and
OAuth endpoints from the extension page using standard cross-origin requests,
which Google's APIs allow. The screen clipper uses activeTab, which is granted
per-invocation by the user, rather than standing access to any site.
```

## Data disclosure

- Notes, pages, pasted images and screen clips are stored **locally in
  IndexedDB**. A clip is a cropped screenshot of the region the user drew,
  plus the source page's URL and title; it is captured on the user's explicit
  action and never leaves the device unless they turn on sync.
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
