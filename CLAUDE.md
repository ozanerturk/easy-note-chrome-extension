# Easy Note — working instructions

Chrome extension (MV3) that replaces the new-tab page with a freeform note canvas.
Plain ES modules in `js/`, no framework, no bundler except for the vendored
TipTap/OCR builds (`npm run build`).

## Testing: fast during the work, full at the end

Do **not** run the whole suite after every edit. `npm run test:ui` launches real
Chromes and drives every interaction suite — about 35s in parallel, still far
slower than the one or two suites a change actually touches.

The loop is:

1. **While building a feature or chasing a bug** — run only what the change touches:
   ```
   npm run test:ui -- gallery          # one suite
   npm run test:ui -- gallery ocr      # a few, by substring match
   node test/delta.test.mjs            # a single unit file
   ```
   Iterate here until the targeted suites are green. Keep going with just these.

2. **Once, at the end, before calling the feature done** — the full sweep:
   ```
   npm run test:all                    # unit tests, then every UI suite
   ```
   Only report the work as finished after this passes. If it surfaces a failure in
   an area you didn't touch, fix it or say so explicitly — don't quietly skip it.

Re-run the full suite only if a later change is broad (shared modules like
`js/store.js`, `js/db.js`, `js/view.js`, `js/main.js`) or if the targeted run was
already failing for unrelated reasons.

### Which suite covers what

| Change in | Run |
|---|---|
| `js/note.js`, `js/board-note.js`, drag/resize/create | `notes`, `spring` |
| `js/view.js`, `js/pages.js`, panning/zoom | `navigate`, `pages`, `origin` |
| `js/editor.js`, `js/richtext.js` | `editor`, `apps`, `sums` |
| `js/calc.js` | `node test/calc.test.mjs`, `sums` |
| `js/clip/*`, paste, images | `clip`, `clipboard` |
| `js/gallery.js` | `gallery` |
| `js/ocr.js` | `ocr` |
| `js/tray.js` | `tray`, `sidebar` |
| `js/list.js`, `js/board.js` | `lists`, `notes` |
| `js/sync.js`, `js/syncui.js` | `sync` |
| `js/floating.js`, `js/float/*` | `floating`, plus `node test/floating.test.mjs` |
| `js/undo.js`, `js/history.js` | `history` |
| `js/reminders.js`, `js/notify/*` | `reminders`, plus `node test/notify.test.mjs` |
| `js/migrate/*`, `js/tips.js` | `npm test` (unit only) |

Unsure which suite covers a change? Grep `test/ui/` for the feature name rather
than defaulting to the full run.

## Test layout

- `test/*.test.mjs` — unit tests over pure functions. Fast, run freely.
- `test/ui/*.test.mjs` — real Chrome over the DevTools protocol, one fresh page and
  empty IndexedDB per suite. Gestures are dispatched as trusted input on purpose;
  never "fix" a flaky UI test by swapping back to synthetic `.click()`.
- `test/ui/run.mjs` — the runner. New suites must be added to its `SUITES` array or
  they never run. Suites are spread across several headless Chromes (60% of the cores
  by default — more only makes it flakier; `-j 2` to change it). `--headed` runs one visible Chrome, one
  suite at a time, for watching a test or ruling out a parallelism flake.
- `test/ui/harness.mjs` — browser launch, page helpers, `suite()` assertions.
  - `page.settle(ms)` waits until the page has nothing in flight — short timers,
    IndexedDB transactions, worker messages, fetches, animations under a second —
    and never longer than `ms`. Use it after a gesture.
  - `page.pause(ms)` is plain time passing. Use it only when the test is about
    time itself: a clock that has to tick, a key that has to be held, a toast that
    has to be up long enough to read. A `settle` there returns early and the check
    fails.
  - `QUIET_DEBUG=1` prints what held each long `settle` to its full length;
    `CHECK_TIMES=1` stamps every check with the seconds into its suite. Both are
    for finding where a slow suite spends its time.

A UI suite needs Chrome for Testing under `.chrome/`; if it's missing the harness
can't launch and the failure is environmental, not a regression.

## Other commands

```
npm run dev          # live-reload dev server
npm run build        # rebuild vendored TipTap + OCR bundles
npm run package      # build + zip for the Web Store
npm run screenshots  # store screenshots
```

## Conventions

- Match the surrounding style: short files, lowercase prose comments that explain
  *why*, no JSDoc blocks, no TypeScript.
- Nothing is on screen that the user has not asked to be there. An action lives
  where the thing it acts on is already in your hands, not in a list of
  everything the app can do: "Put these 3 notes in a list" is on a multi-note
  selection, not on the bare canvas, and there is no menu item for an empty
  list. The rule is that a feature should be findable exactly where you would
  reach for it — and invisible everywhere else.
- Commit messages in this repo are a short declarative phrase about the user-visible
  change ("The gallery says where and when"), not `feat:`/`fix:` prefixes.
- Bump `version` in both `package.json` and `manifest.json` together for a release.
