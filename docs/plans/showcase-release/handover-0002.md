# Handover 0002 — 1.0.3 release and the showcase film

> Continues `handover-0001.md`. Paste this whole file as the prompt for a fresh Claude Code
> session in `/home/chris/dev/c64/c64commander`. When done, write `handover-0003.md` here.

## The rule that still governs this work

**Do not tag `1.0.3` in either repository until a release run demonstrably satisfies both
gates**: `verify-showcase.mjs` reporting zero missing strings against `showcase-expected.txt`,
and `build-presentation.mjs` reporting at least 85% scene coverage. Neither has passed yet.

## What changed since handover 0001

Handover 0001 said the smoke test failed and the cause was unknown. It is now known, and the
smoke gate passes. Four defects were found in the app and five in the walk.

### The app (c64commander, all merged to `main`)

- **PR #414** — `SheetOverlay` painted a fully opaque `bg-scrim` backdrop. `Dialog` and
  `AppSurface` both dim by depth through `resolveInterstitialBackdropStyle`; `Sheet` never got
  that wiring, so every sheet built on `components/ui/sheet.tsx` covered the page with solid
  black instead of showing it dimmed. Also: `applyFullScreenFromSettings` hid the status and
  navigation bars from the build variant's static defaults with no regard for the screen, so the
  `c64u-remote` APK hid both on any device. `resolveDefaultHideStatusBar` /
  `resolveDefaultHideNavigationBar` now take the resolved display profile.
- **PR #415** — the variant pinned `default_display_profile: compact`, forcing the small-panel
  presentation onto every device running the APK. Now `auto`. The 8020 is 320 CSS px so it still
  resolves to compact, and the recording geometry is unchanged; a 392 px phone now gets medium.
- **PR #416** — six controls carried only `data-testid`. **A WebView exposes the DOM `id` to
  Android as the accessibility resource-id and does not expose `data-testid` at all**, so a
  Maestro `id:` selector could not reach them. They now carry both, as `tab-play` and
  `add-items-to-playlist` always did.

Tagged as `1.0.3-rc7` at `6bc5fcd2c`.

### The walk (c64u-remote-dist `main`)

- Three selectors matched text that is not what the accessibility tree holds: the style tile is
  `"Deep CutsRarely-heard corners of HVSC"` (label and blurb, one node, **no space**), `Add items`
  has `aria-label="Add items to playlist"`, `CommoServe` has `aria-label="Search CommoServe"`.
  Wildcards fixed those. The Reboot row is `"RebootReboots the C64 Ultimate…"` — anchored as
  `^RebootReboots.*`, because a bare `.*Reboot.*` also matches `Reboot (Clr Mem)`.
- **The tap that ended six runs**: on the 320x427 panel the row holding SID Radio / Find a tune /
  Liked Tunes wraps below the fold, its first button half under the tab bar. Maestro *finds* a
  half-covered button and reports the tap COMPLETED — but the tap lands on the tab bar. Every
  trigger is now scrolled to and centred first. This never reproduced on a 829 px-tall phone.
- The four long Settings/Docs scrolls were given 90s–240s; the eight Home coverage scrolls were
  made optional so one stalled scroll cannot lose a whole attempt.
- The Remote Input scene only ever showed the joystick, so `CTRL`, `RETURN` and `SHIFT` had no way
  of reaching the film. It now presses `Keys`, scrolls to `CTRL`, and returns to `Joystick`.

### A defect in the expectations themselves

`RSTOP` was in both `SHOWCASE-SCRIPT.md` and `showcase-expected.txt`. **The app never draws that
string** — the key is labelled `RUN` over `STOP` on two lines, accessible text `"RUNSTOP"`. The
OCR gate could not have passed while it stood, whatever the walk did. Removed from both;
`scripts/script-coverage.mjs --strict` reports `total uncovered: 0`.

## Where things stand

- Smoke **passes** (`exit-code: 0`, `result: success`) — run 34026706971 was the first, and it
  captured all six page screenshots.
- The OCR gate has run **once**: `covered: 170/204`, with 34 strings never visible. Most were the
  sheets the mis-targeted taps never opened, which #416 and the id-based selectors address.
- `1.0.3-rc7` is tagged; its Android build was still queued when this was written. Nothing has
  been released yet, and **there is still no `1.0.3` tag** in either repository.

## Next steps

1. Wait for `1.0.3-rc7`'s `c64commander-1.0.3-rc7-android.apk` to attach, then
   `gh workflow run release --field version=1.0.3-rc7 --field overwrite=true -R chrisgleissner/c64u-remote-dist`.
2. Read the OCR gate's new missing list. Expect it to be far shorter than 34. Known remaining
   suspect: `Source: CommoServe` is a Lighting chip (`Source: ${bucket}`) that only shows while a
   CommoServe-sourced item is active, and the walk plays an HVSC tune — it may need either a
   CommoServe playback step or removal from the script.
3. When both gates pass, tag `1.0.3` at the same commit, wait for its APK, then dispatch the
   release for `1.0.3`.

## How to work on this

Everything in handover 0001's "How to work on this" still applies. Added to it:

- **`id:` is the DOM id, not `data-testid`.** If a control has only a testid, a Maestro `id:`
  selector silently warns. Check with
  `document.querySelector('[data-testid="x"]').id` over CDP before writing the selector.
- **A COMPLETED tap is not a tap that landed.** Maestro will happily tap the centre of a
  partially-covered element, and the tab bar takes the hit. Scroll and centre before tapping
  anything near the bottom of the panel.
- **Reproduce at the real geometry.** `adb shell wm size 480x640 && adb shell wm density 240` is
  what `smoke-test.sh` sets; a 392x829 phone hides every one of these defects. **Reset both
  afterwards** — a leftover override breaks later HIL runs.
- **Read the run's own step statuses, not its exit code.** `commands-(showcase.yaml).json` in
  `~/.maestro/tests/<timestamp>/` lists every WARNED and SKIPPED step. That is what turned "34
  strings missing" into a list of six mis-targeted taps in one pass.
- **The runner is this machine.** `~/.maestro/tests/` and
  `/home/chris/dev/actions-runner/_work/c64u-remote-dist/c64u-remote-dist/evidence/` can be read
  live, mid-run, instead of waiting ~25 minutes for the artifact.
- **Host contention is real and not yours to fix.** An unrelated `make -j 8 u64ii` has been at 91%
  of a core for days. Under it, `dev.mobile.maestro`'s instrumentation crashes mid-walk and
  arbitrary elements go missing. Before blaming a change, check whether the failures move around
  between attempts — a fixed defect fails at the same step every time.
