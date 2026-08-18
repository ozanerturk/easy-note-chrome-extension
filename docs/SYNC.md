# Google Drive sync

Notes, pages and pasted images sync through a hidden per-user Drive folder
(`drive.appdata`), which never appears in My Drive and cannot be browsed by the
user. Sign-in uses `chrome.identity.getAuthToken`.

## The extension id is pinned — do not remove the manifest `key`

`getAuthToken` issues a token **only** when the running extension's id matches
the id registered on the OAuth client. An unpacked extension normally derives
its id from its folder path, so it differs per machine and per checkout — which
is why sign-in first failed with `bad client id`.

`manifest.json` therefore carries a `key`: the published extension's own public
key, lifted from its Web Store CRX. It pins every build, packed or unpacked, to
the published id `hheobakelknbjicekbkmijjgcbephcef`, so development and
production share one id and one OAuth registration.

Deleting that `key` will break sign-in everywhere. To verify it still resolves
correctly:

```bash
python3 -c "
import json, hashlib, base64
m = json.load(open('manifest.json'))
h = hashlib.sha256(base64.b64decode(m['key'])).hexdigest()[:32]
print(''.join(chr(ord('a') + int(c,16)) for c in h))
"
# -> hheobakelknbjicekbkmijjgcbephcef
```

> The `key` on the `v2` branch is **not** the store key — it resolves to
> `jchdfjgabcihfhcbpknnlophmnejpjel`. Do not reuse it.

With the id pinned, `getAuthToken` stops reporting `bad client id` and reports
`OAuth2 not granted or revoked` instead, which simply means nobody has consented
yet. That is the expected state before the first sign-in.

## If sign-in still fails

### The client must be "Chrome Extension" type

In Google Cloud Console → **APIs & Services → Credentials**, the client's type
must be **Chrome Extension** (older consoles call it *Chrome App*), with its
**Item ID** set to `hheobakelknbjicekbkmijjgcbephcef`. A **Web application**
client cannot be used with `getAuthToken` at all — that needs
`launchWebAuthFlow`, a different implementation.

### Enable the Drive API

In the same project, **APIs & Services → Library → Google Drive API → Enable**.
Without it, sign-in can succeed and every Drive call then fails with 403.

### Consent screen scopes and test users

The consent screen must list both scopes:

- `https://www.googleapis.com/auth/drive.appdata`
- `https://www.googleapis.com/auth/userinfo.email`

While the app is in **Testing**, only accounts added under *Test users* can
sign in. Everyone else gets a consent error that looks unrelated.

## How syncing works

One document plus one file per image, all in `appDataFolder`:

```
easynote.json     { version, notes: [...], pages: [...] }   (tombstones included)
img-<imageId>     one file per pasted image
```

**Merging is per record, not per document.** Each note and page carries
`updatedAt`, and the newer side wins individually — so two devices editing
different notes both keep their work, which a whole-file overwrite would not.

**Deletes are tombstones.** A deleted record stays, flagged
`{ deleted: true, deletedAt }`. Without that a delete cannot propagate: the
other device still has the note, and it reappears on the next sync. Tombstones
are purged after 30 days, along with any images only they referenced.

**Images are immutable**, so they are never merged — only copied whichever way
is missing. They are addressed by their id, and only images referenced by a
live note are considered.

`updatedAt` moves on *every* mutation because merging depends on it. The
"last edited" time shown on a note is a separate field, `editedAt`, which only
moves when the content itself changes.

## Known limitations

- **Concurrent writes can lose an update.** Two devices syncing at the same
  moment both merge against the same remote document, and the later upload
  wins. The window is small and per-record merging keeps it rare, but it is
  real. Fixing it needs an ETag precondition on upload and a re-merge retry.
- **Sync runs every 2 minutes** and on demand, not on every edit. Fine for one
  person across a few machines; it is not live collaboration.
- **The live OAuth path is unverified.** The merge engine, image reconciliation
  and idempotence are covered by tests against a fake Drive, but no test has
  authenticated against real Google — that needs a registered extension id.
