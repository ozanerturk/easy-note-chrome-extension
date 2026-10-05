# Chrome Web Store submission — Easy Note 3.6.0

Upload package: **`dist/easy-note-3.6.0.zip`** (built by `npm run package`).

> **New in 3.3, and the one thing a reviewer will look twice at:** the package
> is ~7MB bigger, and the manifest now sets a `content_security_policy`. Both
> are the on-device text recognition described below. Nothing about the
> permissions has changed — there are still four, and still no host
> permissions.
>
> **New in 3.5, and the thing a reviewer will look twice at now:** the manifest
> declares `<all_urls>` under `optional_host_permissions`, for floating notes.
> It is optional, not requested at install, and not granted until the user
> floats a note for the first time — see the host permissions section below.
> Nothing is injected into any page before that, and nothing stays injected
> once the last floating note is put away. The manifest also gains
> `web_accessible_resources`, for one file: `float.html`, the extension page a
> floating note is drawn in, framed on the pages it floats over. It is listed
> with `use_dynamic_url`, and draws nothing for a frame the extension did not
> put there itself.

> **New in 3.6, and the other thing a reviewer will look at:** an opt-in switch,
> "Connect to Claude", makes the extension open a WebSocket to a relay the
> developer runs (`wss://relay.easynote.tayfai.tech`). It is off by default and
> nothing connects until the user turns it on. It adds no permission and no
> host permission — a WebSocket needs neither — and its only manifest change is
> `minimum_chrome_version: "116"`. What it sends and keeps is in the
> "Connect to Claude" section below, and the privacy policy says the same.

## Assets in this folder

| File | Where it goes |
| --- | --- |
| `screenshot-1-canvas.png` | Screenshot (1280×800) — the board and page tree |
| `screenshot-2-gallery.png` | Screenshot — a picture opened full size, with its text selected |
| `screenshot-3-clip.png` | Screenshot — clipping a region out of a web page |
| `screenshot-4-tray.png` | Screenshot — the Capture tray holding what was clipped |
| `screenshot-5-dark.png` | Screenshot — the same board in dark mode |

Upload them in that order — the files are numbered by it. The store shows five
at most, and the first is the one most people judge the extension on, so the
board leads and the newest reason to install comes straight after it: in 3.3
that is a picture opened full size with its own text selected on it. The
search shot came out to make room; search is not what sells this version.

The picture in the gallery shot is drawn by the script, not a real screen.

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

The extension requests **no host permissions at install**. One optional host
permission, `<all_urls>`, exists for floating notes and is asked for at the
moment a user first floats one.

No host permission was ever required: Google's API endpoints answer cross-origin
requests from an extension page without them — the Drive list, upload,
userinfo and revoke calls all succeed, and a real authenticated sync round trip
completes. The screen clipper added in 3.2 was deliberately built on
`activeTab` for the same reason. Floating notes, added in 3.5, are the first
feature that genuinely cannot work that way: a note that follows the user from
page to page has to be drawn on pages the user has not invoked anything on. It
is therefore optional and off until asked for.

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

Nothing is sent anywhere other than the user's own Google Drive, with one
opt-in exception: if the user turns on "Connect to Claude" (off by default),
the same token is shown once per connection to the developer's relay, to prove
which Google account this browser belongs to (see the Connect to Claude
section). There is no analytics and no tracking. The extension is fully usable
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

### `content_security_policy` — if the review asks

New in 3.3. The manifest sets:

```json
"content_security_policy": {
  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
}
```

```
Easy Note 3.3 can read the text inside a picture in a note, so it can be
selected and copied — a screenshot of an error message, a photo of a
whiteboard. The recognition engine is WebAssembly, and 'wasm-unsafe-eval' is
what Chrome requires to compile WebAssembly at all on an extension page.

It does not relax anything else. script-src is still 'self': no remote code,
no eval, no inline script. The engine, its wasm core and both language models
(English and Turkish) are files inside the package — nothing is fetched at
runtime, and the feature works with the network switched off. That is also why
the package grew by about 7MB in this version.

No picture, and nothing read out of one, is ever sent anywhere. Recognition
runs in a Web Worker on the user's own machine and the result is cached
locally so a picture is only ever read once.
```

### Connect to Claude — new in 3.6, if the review asks

No permission was added for it; its only manifest change is
`"minimum_chrome_version": "116"`.

```
"Connect to Claude" is an optional switch in the sync panel, off by default.
It lets the user ask Claude (Anthropic's assistant), in their own Claude
account, about their own notes: it can search notes, read one, and add a line
of text to the Capture tray. It cannot edit, move or delete anything. It serves
the extension's single purpose, a note-taking tool, by letting the user reach
their notes from the assistant they already use.

When the user turns it on, the service worker opens a WebSocket to
wss://relay.easynote.tayfai.tech, operated by the developer, and keeps it open
while Chrome runs (a keepalive every 20 seconds). The first message carries the
user's Google access token, which the relay checks with Google and accepts only
if it was issued to this extension's own OAuth client; that tells it which
Google account the browser belongs to. The relay passes on a request that
Claude made for the same account, and the extension answers from the user's
local notes. A WebSocket needs no host permission.

The relay does not store or log note contents, search words or results. It
keeps four things: an opaque Google account id, a SHA-256 hash of the sign-in
refresh token, the Claude connector's registration, and the user's Google
refresh token for the Drive app-data scope, encrypted (AES-256-GCM) at rest.

That last one lets the relay answer when Chrome is closed: if the extension is
not connected, the relay refreshes an access token, reads the user's own
easynote.json (the sync copy this extension already writes to their Drive app
folder) with GET requests only, answers, and keeps nothing of it beyond a
minute in memory. The same Cloud project's web client is used, so no new
account or storage is involved. The stored token is deleted when the user turns
the switch off (the extension tells the relay, which also revokes it at
Google), when Google reports the access removed, and after 90 days unused.
Nothing is sent unless the switch is on and Claude has asked, and turning it
off closes the connection at once.

No remote code is loaded or evaluated: script-src is still 'self', and the
relay only ever sends data. minimum_chrome_version is 116 because from that
version WebSocket traffic keeps the Manifest V3 service worker alive.
```

### Host permissions — one, optional, for floating notes

Nothing is requested at install. `<all_urls>` is declared under
`optional_host_permissions` and is requested by `chrome.permissions.request()`
from the click that floats a note.

```
Easy Note requests no host permissions at install time. It calls Google's
Drive and OAuth endpoints from the extension page using standard cross-origin
requests, which Google's APIs allow, and the screen clipper uses activeTab,
granted per-invocation by the user.

One optional host permission, <all_urls>, is used for a single feature:
floating notes. A floating note is a note the user has explicitly chosen to
keep on screen over every page they visit, which requires drawing it on those
pages. Easy Note asks for this permission at the moment the user first floats
a note, never at install, and a user who does not use the feature is never
asked and never grants it.

The content script that places a floating note is registered dynamically, only
while at least one note is actually floating, and is unregistered as soon as
the last one is put away. It reads nothing from the page it is on. It adds one
iframe per floating note, pointing at the extension's own float.html, and the
note is drawn inside that frame, from the user's own local database, by the
extension's own origin; the content script never handles the note's contents.
No page content, URL or browsing activity is read, stored or transmitted.
```

The mechanics, if a reviewer asks: `js/float/background.js` calls
`chrome.scripting.registerContentScripts` when a note starts floating and
`unregisterContentScripts` when the last one stops, and refuses to register at
all while the permission is not granted. `js/float/frames.js` is the injected
script (~7KB) — dependency-free, and it never touches the host page's DOM
beyond appending one iframe per floating note to the document element.

`float.html` is the only web-accessible resource. It is listed with
`use_dynamic_url: true`, so its address changes every session and cannot be
used to fingerprint the extension, and it renders nothing until the content
script hands it a per-session token over a private `MessageChannel` — a site
that frames it itself is shown an empty frame. Everything the frame loads is
a file inside the package; nothing is fetched at runtime, and `script-src` is
still `'self'`.

## Data disclosure

- A floating note is an ordinary note with two extra fields on its record: that
  it is floating, and the position and size it floats at. Both are stored
  locally with the note and sync only through the user's own Drive appdata, the
  same as every other note field. The content script that places it reads
  nothing from the page it is drawn on.
- Notes, pages, pasted images, screen clips and the text recognised inside
  pictures are stored **locally in IndexedDB**. Text recognition runs
  on-device, in a worker, from models shipped in the package; no image or
  recognised text is transmitted anywhere. A clip is a cropped screenshot of the region the user drew,
  plus the source page's URL and title; it is captured on the user's explicit
  action and never leaves the device unless they turn on sync.
- If — and only if — the user signs in, that same data is copied to a
  **hidden per-user Drive app folder** (`drive.appdata`). It does not appear in
  My Drive, and the scope grants no access to any other file in the account.
- The extension collects **no analytics and no telemetry**. The Google
  Analytics tag lives only on the hosted release-notes web page and is stripped
  from the packaged extension, because MV3 blocks remote scripts anyway.
- Nothing is sent to any server other than Google Drive, on the user's behalf —
  with one **opt-in exception**. With "Connect to Claude" on (off by default),
  the extension holds a WebSocket to the developer's relay. Through it passes
  whatever Claude asks for and the browser answers — search results, one note,
  or a line to add to the Capture tray. The relay does not store or log it.
  When the browser is not connected it reads the user's own sync copy from
  their Drive instead (see the section above) and does not keep it. The relay
  keeps an opaque Google account id, a hashed refresh token, the connector's
  registration and an encrypted Google refresh token for Drive app-data access,
  and is shown the Google access token once per connection to check the
  account.

Answer the disclosure form as: collects **personal communications** (the note
content) only when sync or "Connect to Claude" is enabled; not sold; not used
for anything unrelated to the single purpose. For Connect to Claude, also
declare **authentication information** (the Google access token shown to the
relay to prove the account, and the encrypted Drive refresh token the relay
**does store**) and the account **id** the relay keeps. These categories are my best reading of the form's wording — check each
against what the dashboard actually asks.

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
- [ ] **The relay is up.** `https://relay.easynote.tayfai.tech/healthz`
      answers, and the extension connects to it with the switch on. A reviewer
      may try the feature.
- [ ] **The relay's Google OAuth client** (type *Web application*, redirect URI
      `https://relay.easynote.tayfai.tech/oauth/google/callback`) shares this
      project's consent screen, so it must be **published** too, or only test
      users can connect Claude. It asks for `openid`, `email` and
      `drive.appdata` — the same Drive scope the extension already has, now also
      requested with offline access so the relay can read the user's notes when
      Chrome is closed. Check that scope is on the consent screen's list.
- [ ] **The relay has `CREDENTIAL_KEY` set** in its `.env` (it will not start
      without it), and a copy of that key is kept somewhere safe.
- [ ] Update the dashboard's **Privacy practices** tab with the data types
      above, and check the privacy policy URL shows the new "Connect to Claude"
      section.
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
