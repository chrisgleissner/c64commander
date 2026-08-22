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

## Also check

- `tests/unit/readmeScreenshotCoverage.test.ts` — asserts the README's gallery references resolve.
- Any Playwright locator that matches a dialog **by name**. The discovery locator in
  `playwright/screenshots.spec.ts` matched `/C64 systems found/i` and would have silently stopped
  finding the dialog rather than failing loudly.
