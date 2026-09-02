# Pending: screenshot regeneration

Standing note. **Do this once all other in-flight work on this branch is finished**, not before —
regenerating early only means doing it again after the next UI change.

## Why

UI copy and layout changed on this branch, so some committed PNGs under `docs/img/app/` show text or
spacing the app no longer produces.

Known so far:

- Discovery interstitial titles changed to **"Choose your C64"** (devices found) and
  **"No C64 found"** (none found). `docs/img/app/launch/discovery/startup-autodiscovery-interstitial.png`
  has already been recaptured for this; anything else showing that dialog has not been checked.
- The compact-profile density work on `ux/compact-density` (separate branch) will change spacing on
  most compact screenshots when it lands.
- The follow-focus feature on `feat/follow-focus` (separate branch) adds Live View UI.
- Demo Mode is on by default from `demo-mode-offline-and-av-stream`, so **Settings → Devices** now
  shows a checked **Automatic Demo Mode** and a **Preview Demo Mode** button, and everything below
  them in that group has moved down. Nothing under `docs/img/app/settings/` has been recaptured for
  it. A whole-corpus run on that branch was checked and discarded: all 252 files it rewrote differed
  only by antialiasing or by where the page happened to be scrolled, which is the trap below.

## How — and the trap

Do **not** simply run `npm run screenshots` and commit the result. It rewrites roughly 200 PNGs with
machine-specific render drift (fonts and antialiasing differ from the machine that produced the
committed corpus), so the diff is mostly noise and hides the handful of real changes.

Instead:

1. Build for the default variant first. `dist/` may hold a `c64u-remote` build from HIL work, and
   the screenshots must be captured from the `c64commander` variant:
   ```bash
   npm run build
   ```
2. Capture only what changed, on a private port — 4173 is shared with other agents on this machine
   and a collision looks like a test failure:
   ```bash
   TRACE_ASSERTIONS_DEFAULT=1 PLAYWRIGHT_TRACE_MODE=off PLAYWRIGHT_VIDEO_MODE=off \
   PLAYWRIGHT_PORT=4791 npx playwright test playwright/screenshots.spec.ts \
     -g "<test name>" --workers 1
   ```
3. Check what actually changed before staging:
   ```bash
   git status --short docs/img/
   ```
   The repo's `png-prune` pre-commit hook reports `scanned=N reverted=N deleted=N kept=N`. A file it
   keeps is a real content change; one it reverts was drift. If a file you did not intend appears,
   revert it: `git checkout -- docs/img/<path>`.

## Three things that differ without the app changing

A recapture rewrites files whose pixels differ for reasons that have nothing to do with the UI.
Do not commit those: measured on this branch they were the large majority of the diff.

- **The build identity.** Home's system-info card prints `App <version>`, so every capture taken at
  a different version differs on that line. It accounted for the biggest single group.
- **Live counters.** "PAL 29 fps" against "PAL 30 fps", and the byte counts in the Diagnostics
  connection view.
- **The machine's own configuration.** SID addressing reading `$D400` against `Unmapped`, a drive
  showing ON against OFF. These follow whichever Ultimate the capture ran against.

The way to tell: compute where a file changed, not just how much. A diff confined to one text line
in the header, or to a single value in a table, is one of the three above. A diff that spans a whole
column, or moves everything below a point, is the UI.

There is a durable fix for the first of the three and it is not done: `VITE_APP_VERSION` is honoured
by `vite.config.ts` and pins both the version and its label, so capturing with a fixed value would
stop the corpus churning on every version bump. It is left out here deliberately, because switching
to a pinned label rewrites every screenshot showing that line once, and this branch was asked to
keep the diff to what actually changed.

## Also check

- `tests/unit/readmeScreenshotCoverage.test.ts` — asserts the README's gallery references resolve.
- Any Playwright locator that matches a dialog **by name**. The discovery locator in
  `playwright/screenshots.spec.ts` matched `/C64 systems found/i` and would have silently stopped
  finding the dialog rather than failing loudly.
