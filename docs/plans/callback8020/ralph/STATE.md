# Callback 8020 Ralph loop — STATE digest

Compact acceleration aid for the loop in `callback8020.ralph.prompt.md`. Live
evidence always wins over this digest. Refresh it compactly at the end of each
increment. Full target + definition of done: `../handover/backlog.md`.

- **Branch:** `feat/introduce-new-variant` (verify with `git status`).
- **Variant under test:** `c64u-remote` / `C64U Remote` / `uk.gleissner.c64uremote`, Android-only.

## Green on HEAD (verified)

- `npm run lint`, `npm run test`, `variant:check`, `feature-flags:check` — green.
- `npm run test:coverage` — green: Branches 91.53%, Lines 94.59% (≥ 91% gate). Version test
  (`releaseVersionMetadata`) passes (`package.json`/`lock` at `0.8.8-rc2`).
- Both APKs build (`node scripts/build-android-apks.mjs --target ci --verify-metadata`);
  metadata + no-GMS gates pass; c64u-remote ships INTERNET-only.
- Playwright `callbackSmallScreen.spec.ts` — no overflow at 480×640 / 320×480.
- Physical de-Googled Pixel 4: install + coexist + launch + name + pruned + keypad-only + no-GMS.
- Waydroid VANILLA (no-GMS) smoke: C64U Remote install + launch + verified PASS
  (`scripts/waydroid-smoke.sh run`; headless `kwin_wayland --virtual`).

## Backlog status (see ../handover/backlog.md for the live checkboxes)

- M1 (gates green): essentially done — coverage/lint/test/variant/flag green; perf-budget log
  lines confirmed benign. Tidy any residual M1 checkbox, then advance.
- M2 keyboard-only CTA completeness — **next recommended slice** (start with a per-screen CTA
  reachability audit + FocusController registration for the highest-traffic screen).
- M3 T9 text-input completeness; M4 small-screen polish; M5 substitute-layer CI depth;
  M6 real Sailfish/Callback hardware (EXTERNAL — prepare only); M7 hardening.

## Next recommended slice

M2: audit primary CTAs on Home (and one more screen) for keyboard/d-pad reachability +
activation; register the ones needing deterministic order via `FocusController`; add a unit
test asserting traversal/activation. Verify with the affected vitest subset (+ Playwright if
layout changes). Then tick `backlog.md` and write the next `../handover/NNNN-handover.md`.

## Notes

- Keep `README.md` free of Callback/Sailfish/C64U-Remote references; stale-name guard must stay green.
- Waydroid/emulator are non-blocking substitutes; `waydroid shell` needs root + adb needs auth
  on this host, so the Waydroid smoke uses user-level `waydroid app install/launch/list`.
