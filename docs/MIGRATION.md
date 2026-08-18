# Migrating published v1 users to v3

> **Status: implemented and verified against the real published extension.**
> v1.3.1 was pulled from the Web Store, pinned to the same extension id, run,
> and used to author notes; v3 was then loaded over that same profile and
> imported them. Everything below marked *verified* was observed, not inferred
> from source. See `js/migrate/`.

Scope decided: **migrate from the published v1 only.** `v2` never shipped, so
no real users hold Dexie data. Sync is not being built yet, but the v3 model is
being shaped so adding it later is not another rewrite.

## Why this is easier than it looks

v1 and v3 ship under the same extension id
(`hheobakelknbjicekbkmijjgcbephcef`), so they share an origin and v3 can open
v1's IndexedDB directly. No export file, no user action, no server.

## Why it is harder than it looks

Everything about the shape differs.

| | v1 (published 1.3.1) | v3 |
| --- | --- | --- |
| Database | `easy-note`, version 1 | `easynote`, version 4 |
| Store | `notes` (keyPath `id`) | `notes`, `images`, `pages`, `meta` |
| A note is | one entry in a **single JSON string** | one record |
| Note id | `uniqueId` (uuid) | `id` |
| Content | **Quill Delta** (`contents`) | HTML (`html`) |
| Colour | `theme` (name) | `color` (hex) |
| Size/pos | `x, y, width, height` | same |

v1's `notes` store holds exactly three keys:

```
{ id: "version",     value: "1.3.0" }
{ id: "preferences", value: <object> }
{ id: "default",     value: "<JSON string of the whole note array>" }
```

So migration reads **one key** (`default`) and `JSON.parse`s it — there is no
note table to iterate.

### `innerHTML` is not recoverable

v1's `Note` constructor keeps an `innerHTML` field marked `// migariton`, which
looks like a ready-made migration path. It is not: `saveChanges()` serialises
with a replacer that drops `__quill`, `quill` **and `innerHTML`**, so the field
was never persisted. Converting the Delta is the only route.

### The real persisted note (verified)

Captured from v1.3.1 itself, not read off its source:

```json
{
  "uniqueId": "ade4ac6c-4a87-4215-abea-e16fad6cf36c",
  "theme": "default",
  "contents": { "ops": [ … ] },
  "x": 1050, "y": 600,
  "width": "", "height": null,
  "element": {}, "option_btn": {}, "header": {}, "bodyWrapper": {},
  "resizerBottomRight": {}, "resizerTopLeft": {}, "toolbar": {}, "body": {}
}
```

Three things here that reading the source did **not** reveal, each of which
would have produced broken imports:

- **`contents` is `{ops: […]}`**, not a bare Delta array.
- **`width` is `""` and `height` is `null`** for any note the user never
  manually resized. Copying those across yields notes with no size, so both
  fall back to defaults (240×180).
- Eight DOM references (`element`, `option_btn`, `header`, `bodyWrapper`, the
  two resizers, `toolbar`, `body`) each serialise to `{}`. Ignore them all.

Also verified: the `version` record reads `"1.3.0"` as a **string**, even
though the shipped manifest says `1.3.1`.

## The migration

Run once, on first v3 boot, keyed by a `meta` flag so it never repeats.

1. Check `indexedDB.databases()` for `easy-note` **before opening it**.
   `indexedDB.open()` *creates* a database that does not exist, so opening
   blindly would grow an empty `easy-note` on every fresh install. If absent,
   the user is new — mark migration done and stop.
2. Open it **read-only**.
3. `JSON.parse` the `default` value. On parse failure, abort and leave a
   `meta.migrationError` record rather than starting with a blank canvas.
4. Create the destination page (`"My notes"`) if it does not exist.
5. For each v1 note, write a v3 record:
   - `id`: reuse `uniqueId` — already a uuid, so it stays stable for sync
   - `html`: `deltaToHtml(contents)`
   - `color`: `THEME_COLORS[theme.toLowerCase()]`, defaulting to the v3 default
   - `x, y`: copied as-is (v1's pageX/pageY map onto world coordinates)
   - `width, height`: coerced, falling back to 240×180 — v1 stores `""`/`null`
   - `pageId`: the destination page
   - `createdAt` / `updatedAt`: now, since v1 recorded neither
   - `z`: index in the array, preserving v1's stacking order
6. Write the `migratedFromV1` flag so it never runs twice.

**Never write to, clear, or delete the `easy-note` database.** A user who
reverts to v1 must find their notes intact, and a failed migration must be
retryable. The cost is duplicated storage for a while, which is not a concern
given IndexedDB's quota.

### Delta → HTML

Only what v1 could actually produce needs support. v1 used a stock Quill
toolbar, so: `bold`, `italic`, `underline`, `strike`, `link`, `header`,
`list` (ordered/bullet), `code-block`, `blockquote`, and plain newlines.

A Delta is a flat op list, and the formatting that becomes a block element is
carried on the op holding the **trailing newline**, not on the text itself —
that is the part naive converters get wrong. Approach: accumulate inline ops
into a line buffer, and when an op's insert contains `\n`, close the line using
that op's `attributes` to pick the wrapper.

Write it as a standalone `js/migrate/delta.js` with unit tests over fixture
Deltas, so it can be verified without a browser. Bundling Quill just to convert
was rejected — it is a heavy dependency for a one-time conversion in an
otherwise dependency-free extension.

### Theme → colour

v1 has 17 theme classes, and note the case bug: **both `theme-default` and
`theme-Default` exist**, so match case-insensitively.

| theme | hex | | theme | hex |
| --- | --- | --- | --- | --- |
| default | `#fafafa` | | navy | `#3333cc` |
| red | `#ff7d7d` | | olive | `#999933` |
| green | `#67ee79` | | maroon | `#cc3333` |
| yellow | `#fff172` | | lime | `#33ff33` |
| orange | `#ffba3c` | | aqua | `#33ffff` |
| teal | `#33cccc` | | fuchsia | `#ff33ff` |
| silver | `#e0e0e0` | | gold | `#ffee33` |
| gray | `#c0c0c0` | | brown | `#d2691e` |

Keep the exact v1 colours rather than snapping to v3's eight-swatch palette.
`color` is a free hex string; the palette is only a set of presets, so an
imported note keeping `#33ffff` costs nothing and a user's colour-coding
survives.

## Shaping v3 for sync — done

These were identified as expensive to retrofit and have since been implemented
(see `docs/SYNC.md`); kept here for the reasoning.

- **Globally unique ids.** v3 currently mints `` `${Date.now()}-${random}` ``,
  which can collide across devices. Move to `crypto.randomUUID()`. Migrated v1
  notes already carry uuids.
- **`updatedAt` on every mutation.** Today only content edits stamp it; move,
  resize, colour and lock changes do not. Any last-write-wins merge needs all
  of them, and the existing "last edited" display gets more accurate too.
- **`createdAt`** on notes and pages. Currently only inferable from the id.
- **Tombstones instead of hard deletes.** A deleted record must become
  `{ deleted: true, deletedAt }` and survive, or deletions cannot propagate and
  deleted notes resurrect from other devices. This changes the load path
  (filter tombstones) and image GC, which currently runs on hard delete —
  blobs would need collecting once a tombstone is beyond the retention window.
- **Same three fields on `pages`.**
- **Images are the hard part.** Blobs are large and not diffable. Whatever
  sync backend is chosen, plan to address them by content hash and upload out
  of band, rather than inlining them into note payloads.

All of these now exist. Tombstones had the most reach into existing code, and
were indeed the one that would have been painful to add after users had data.

## What actually happens now

`js/migrate/delta.js` converts the Delta; `js/migrate/v1.js` reads v1 and
writes v3 records. `main.js` runs it once on boot, before the first render, so
an upgrading user never sees an empty canvas.

**The v1 database is opened read-only and never written, cleared or deleted.**
Someone who reverts to v1 still finds their notes, and a failed import stays
retryable. Duplicated storage for a while is a cheap price.

## Verified behaviour

Against notes authored in the real v1.3.1:

| Check | Result |
| --- | --- |
| Notes imported | 2 of 2 |
| `<h2>`, `<ul><li>`, links, bold, italic | preserved and rendered |
| `width: ""` / `height: null` | defaulted to 240×180 |
| Theme `default` | `#fafafa` |
| v1 database afterwards | all 3 records intact, notes untouched |
| Running the import twice | no duplicates |
| Console errors | none |

## Notes for future work

- **Themes were only exercised as `default`.** v1 sets `theme` through its own
  options UI, which the test drove by DOM class — and that does not persist, so
  the other 15 colours are mapped from v1's CSS but not yet observed end to end.
- **`preferences` came back `{}`** in the test profile and is stored on the
  migration flag for later inspection rather than acted on.
- **Old installs may differ.** v1 keeps its own `version` record, implying it
  had internal migrations, so a long-lived install could hold a shape this has
  not seen. The import fails soft: a parse error records `migrationError` and
  leaves the flag unset so it can be retried.
