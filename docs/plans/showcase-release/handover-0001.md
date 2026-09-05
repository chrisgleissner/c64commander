# Handover 0001 — 1.0.3 release and the showcase film

> Paste this whole file as the prompt for a fresh Claude Code session in
> `/home/chris/dev/c64/c64commander`. It finishes the 1.0.3 release of both
> repositories and the walkthrough video that ships with it. When done, write
> `handover-0002.md` in this folder.

## The one rule that governs this work

**Do not tag `1.0.3` in either repository until the recording demonstrably
satisfies `SHOWCASE-SCRIPT.md` sequence by sequence.** That means
`verify-showcase.mjs` reporting zero missing strings against all 204 expected
strings, and `build-presentation.mjs` reporting at least 85% scene coverage.
Both gates are already wired; neither has passed yet.

## Where things stand

**`c64commander`** — `main` is at `beb2a5817` ("Demo Mode serves the whole app
from the device, and the compact profile is usable on a 320x427 panel", PR
#413, 34 checks green). `1.0.3-rc4` is tagged on it and the upstream
prerelease is published with all four assets. **There is no `1.0.3` tag.**

**`c64u-remote-dist`** — `main` is at `2d03427`. PR #3 is merged, the
`release` workflow is re-enabled. Latest published release is still `1.0.2`;
`1.0.3` was deleted by the user earlier and has not been recreated.

**In flight** — release run `33985348304` for `1.0.3-rc4`, the first carrying
every fix below plus the presentation pipeline. Check it first:
`gh run view 33985348304 -R chrisgleissner/c64u-remote-dist`.

## What is left

1. Get an `rc4` run green: walk completes, OCR finds all 204 strings, caption
   coverage >= 85%.
2. Tag `1.0.3` on `c64commander` at the same commit as `1.0.3-rc4`
   (`beb2a5817`), push it, and **wait for the upstream release to carry
   `c64commander-1.0.3-android.apk`**. The downstream build reads that APK's
   `versionCode`; dispatching before it is attached fails with "no assets
   match the file pattern". The release object appears before the APK does.
3. `gh workflow run release --field version=1.0.3 --field overwrite=true -R
   chrisgleissner/c64u-remote-dist`.
4. Confirm the release carries the APK, manual, source, `showcase.mp4`,
   `showcase-1080p.mp4`, `showcase.srt`, `showcase.vtt` and `youtube.md`.

## How to work on this

The expensive mistake in the previous session was debugging one CI failure per
~35-minute release cycle. Do not do that.

- **Audit every step's effect, not its status.** After any run, parse
  `~/.maestro/tests/<timestamp>/commands-*.json` and list every step whose
  `metadata.status` is not `COMPLETED`. A `SKIPPED` guard and a `WARNED`
  optional assertion both do nothing and both look green. (`showcase-hold`
  warnings are the deliberate dwell trick and are expected.)
- **Look at `screenshot-*.png` in that directory before theorising.** It has
  settled three separate diagnoses instantly, including one where the app was
  working perfectly behind a system ANR dialog.
- **Iterate on the Pixel 4, not on release runs.** It is attached, and
  `smoke-test.sh` only ever selects `emulator-*` serials, so it is invisible
  to CI. Put it in airplane mode first (`adb -s 9B081FFAZ001WX shell cmd
  connectivity airplane-mode enable`) — it must never reach real hardware.
  Write a small flow and run `~/.maestro/bin/maestro test --device
  9B081FFAZ001WX <flow>.yaml`. Three fixes were proven this way in minutes.
- **Never leave an emulator attached while a release records.**
  `smoke-test.sh` refuses when it sees two rather than guessing, and a
  leftover emulator holding port 5554 wedged one run for 70 minutes.
- **Verify a push landed where the pipeline reads it.** Three fixes were
  pushed to a feature branch after its squash-merge and two full cycles were
  spent testing code that was never on `main`. Check the run's `headSha`.

## Traps this repository will spring on you

- **`APP_VARIANT=… npm run variant:generate` rewrites tracked files** —
  `src/generated/`, `index.html`, Android brand resources — and 111 PNGs under
  `docs/img/app/styles/`. Committing after it produced four red CI jobs that
  each looked like a separate defect. Always follow with a plain
  `npm run variant:generate`, then `git checkout -- docs/img`, and confirm
  `grep selectedVariantId src/generated/variant.ts` says `c64commander`.
- **Maestro anchors text matches.** A row rendering a label above a
  description is one accessibility node — `"Power Cycle Cuts the power and
  restores it, …"` — so `text: "Power Cycle"` never matches. The shared close
  control is `×Close`, not `Close`, which is why eleven guards silently
  skipped for the life of the flow.
- **The OCR verifier reads pixels; Maestro reads the accessibility tree.**
  Text can be perfectly visible in the video and unselectable by the flow.
- **`ffmpeg force_style` does not survive being passed through a filter
  string** — subtitles then render with default styling or silently not at
  all. The style lives in `showcase.ass` for that reason.
- **A generated `color=` input needs a duration**, and giving it one truncated
  the whole presentation cut to a single second. The canvas comes from padding
  the scaled picture instead.
- `c64u-remote-dist` takes docs, assets and its own plumbing only. A root
  `.json` is rejected by its pre-commit hook, which is why the narration lives
  at `scripts/showcase-scenes.mjs`.
- `import.meta.dirname` needs Node 20.11 and the workflow's `plan` step runs
  older; use `fileURLToPath`.

## What was built, and where

In `c64u-remote-dist`:

- `scripts/script-coverage.mjs` — compares `SHOWCASE-SCRIPT.md` with
  `showcase-expected.txt`. It found 141 promised strings that nothing checked,
  including all eighteen Config page names. Expectations went from 62 to 204.
  `--strict` runs in the release pre-flight so the two cannot drift apart.
- `scripts/showcase-scenes.mjs` — the film's narration. Two short lines per
  scene. **No timings**: each scene names an `anchor`, text the app itself puts
  on screen, and cues are placed by OCR of the actual recording, so a
  re-recorded walk cannot desync them.
- `scripts/build-presentation.mjs` — writes `showcase.srt`, `showcase.vtt`,
  `showcase.ass`, a 1920x1080 cut with the phone on a dark canvas and the
  caption in the column beside it, and `youtube.md` with chapters. Fails below
  85% scene coverage. Runs in the release **after** verification, so it can
  never influence what the release is checked on.

In `c64commander`, PR #413: Demo Mode serving the whole app from the device,
and the compact-profile programme (a `FolderPickerPlugin` crash fix, the
full-screen presentation the display-profile spec requires at compact,
profile-aware sheets, the Add-items browser going from 30% to 48% file list,
two-line select values, and `playwright/compactUsability.spec.ts` measuring 43
surfaces plus two keypad-reachability walks).

## Open items that are not blocking

- **`Kilo Code Review` fails on every PR** with "your account is out of
  credits". Not a code problem; needs the user's account topped up or the bot
  switched to a free model. `main` has no branch protection so it does not
  block a merge.
- **The app emits nothing when a dialog opens or closes, or when the route
  changes.** `useRegisterInterstitial` tracks overlays but logs only Android
  Back dismissals, and `addLog` writes to the in-app diagnostics store rather
  than to console, so none of it reaches the `logcat.txt` CI captures. The
  recommended fix is small and JS-only: a helper calling
  `emitNativeDiagnosticsLog` with a one-line JSON payload under a stable
  prefix, called from `useRegisterInterstitial` and a route-change effect, so
  an agent can read `adb logcat | grep C64UEVENT`. Emit structure only — route
  paths and component names, never user content. This was deferred to keep the
  release moving; it would have turned a multi-cycle diagnosis into one grep.
- **Maestro's `launchApp` stopped working on the Pixel 4** after a
  `pm clear`; `adb shell am start` still works. Reinstalling the APK did not
  fix it. Probes that drive an already-running app still work.
- `docs/plans/compact-density/FINDINGS.md` opens with a *before* audit whose
  fixes already shipped. Quoting its top table as current state is wrong.
