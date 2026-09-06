# Easy Note — working instructions

Chrome extension (MV3) that replaces the new-tab page with a freeform note canvas.
Plain ES modules in `js/`, no framework, no bundler except for the vendored
TipTap/OCR builds (`npm run build`).

## Testing: fast during the work, full at the end

Do **not** run the whole suite after every edit. `npm run test:ui` launches a real
Chrome and drives 15 interaction suites — minutes per run. Running it on each
iteration is the single biggest waste of time in this repo.

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
| `js/note.js`, drag/resize/create | `notes`, `spring` |
| `js/view.js`, `js/pages.js`, panning/zoom | `navigate`, `pages`, `home` |
| `js/editor.js`, `js/richtext.js` | `editor` |
| `js/clip/*`, paste, images | `clip`, `clipboard` |
| `js/gallery.js` | `gallery` |
| `js/ocr.js` | `ocr` |
| `js/tray.js` | `tray`, `sidebar` |
| `js/undo.js`, `js/history.js` | `history` |
| `js/reminders.js` | `reminders` |
| `js/auth.js`, locking | `lock` |
| `js/migrate/*`, `js/tips.js` | `npm test` (unit only) |

Unsure which suite covers a change? Grep `test/ui/` for the feature name rather
than defaulting to the full run.

## Test layout

- `test/*.test.mjs` — unit tests over pure functions. Fast, run freely.
- `test/ui/*.test.mjs` — real Chrome over the DevTools protocol, one fresh page and
  empty IndexedDB per suite. Gestures are dispatched as trusted input on purpose;
  never "fix" a flaky UI test by swapping back to synthetic `.click()`.
- `test/ui/run.mjs` — the runner. New suites must be added to its `SUITES` array or
  they never run.
- `test/ui/harness.mjs` — browser launch, page helpers, `suite()` assertions.

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
- Commit messages in this repo are a short declarative phrase about the user-visible
  change ("The gallery says where and when"), not `feat:`/`fix:` prefixes.
- Bump `version` in both `package.json` and `manifest.json` together for a release.
