# Migrating published v1 users to v3

Scope decided: **migrate from the published v1 only.** `v2` never shipped, so
no real users hold Dexie data. Sync is not being built yet, but the v3 model is
being shaped so adding it later is not another rewrite.

## Why this is easier than it looks

v1 and v3 ship under the same extension id
(`hheobakelknbjicekbkmijjgcbephcef`), so they share an origin and v3 can open
v1's IndexedDB directly. No export file, no user action, no server.

## Why it is harder than it looks

Everything about the shape differs.

| | v1 (published 1.3.2) | v3 |
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
{ id: "version",     value: <number> }
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

Each persisted note is therefore roughly:

```js
{ uniqueId, theme, contents /* Delta */, x, y, width, height, element: {} }
```

(`element` serialises to an empty object — a DOM node with no enumerable own
properties. Ignore it.)

## The migration

Run once, on first v3 boot, keyed by a `meta` flag so it never repeats.

1. Open `easy-note` **read-only**. If it, or the `default` key, is absent, the
   user is new — mark migration done and stop.
2. `JSON.parse` the `default` value. On parse failure, abort and leave a
   `meta.migrationError` record rather than starting with a blank canvas.
3. Create the destination page (`"My notes"`) if it does not exist.
4. For each v1 note, write a v3 record:
   - `id`: reuse `uniqueId` — already a uuid, so it stays stable for sync
   - `html`: `deltaToHtml(contents)`
   - `color`: `THEME_COLORS[theme.toLowerCase()]`, defaulting to the v3 default
   - `x, y, width, height`: copied as-is (both are world coordinates at zoom 1)
   - `pageId`: the destination page
   - `createdAt` / `updatedAt`: now, since v1 recorded neither
   - `z`: index in the array, preserving v1's stacking order
5. Write `meta.migratedFrom = { db: "easy-note", at, noteCount }`.

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
| gray | `#808080` | | brown | `#d2691e` |

Keep the exact v1 colours rather than snapping to v3's eight-swatch palette.
`color` is a free hex string; the palette is only a set of presets, so an
imported note keeping `#33ffff` costs nothing and a user's colour-coding
survives.

## Shaping v3 for sync

Sync is not being built now, but these are the changes that are expensive to
retrofit and cheap to adopt today.

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

Adopting the first four now costs little. Tombstones are the one with real
reach into existing code, and are also the one that is genuinely painful to add
after users have data.

## Rollout

1. Land the Delta converter with tests, no wiring.
2. Land the migration behind a `meta` flag, defaulting **off**.
3. Verify against a real v1 profile: install published v1, create notes across
   several themes with mixed formatting, then load v3 over the same profile.
4. Turn it on, ship, and keep the v1 database untouched for at least one
   release so a rollback stays possible.

## Open risks

- **No real v1 profile has been tested yet.** Everything above is read from
  v1's source, not observed. Step 3 of the rollout is where assumptions about
  the persisted shape get confirmed — particularly that `element: {}` is
  harmless and that no user is on a pre-`default` layout.
- **`preferences`** is read but its contents have not been surveyed; it may
  hold something worth carrying over (grid, theme default).
- **v1 `version` record** suggests v1 had its own internal migrations, so old
  installs may hold a shape that differs from current v1. Worth checking what
  values exist before trusting a single layout.
