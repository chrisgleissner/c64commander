# Pixel 4 Exhaustive CTA Certification Plan

## Current Identity

- Branch: `test/full-cta-coverage`
- Git SHA: `af2d795b2361cc78e52f3013cf3502c0e72c0375`
- Working tree: dirty before this continuation with unrelated-looking local changes in `scripts/repro-cursor-blink-snapshot-restore.mjs`, `src/lib/machine/ramOperations.ts`, `tests/unit/machine/ramOperations.test.ts`, and untracked `scripts/prove-snapshot-all-types.ts`; preserve them.
- Current APK build identity: `android/app/build/outputs/apk/debug/c64commander-0.8.9-af2d7-debug.apk`, SHA-256 `e0f00bc9a9d595566df01b2eb1cfe63992dfc1611d4acce0fe4a21fa56af7891`, built and installed by `./build --skip-tests --install-apk --device-id 9B081FFAZ001WX`.
- Current installed package identity: `uk.gleissner.c64commander` versionName `0.8.9-af2d7`, versionCode `2042`, lastUpdateTime `2026-06-25 07:52:21`, signature short `d39d81d2`.
- Pixel 4 target: `9B081FFAZ001WX`.
- Primary C64U target: `c64u`, password redacted in artifacts, HTTP `80`, FTP `21`, Telnet `23`.
- Artifact roots for this continuation:
  - Original `515e2` evidence: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/`
  - Current `af2d7` evidence: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/`

## Active Phase

In progress on C64U device-safety recovery after Disks mount/eject loop. A readonly manual Disks mount mitigation plus polling-pause guard has one clean Pixel 4 proof on current build `0.8.9-af2d7`; the broader five-cycle repetition is still inconclusive because the repetition harness used a stale coordinate and reopened the mount sheet. The app is stopped after restoring app-visible `C64U` / `c64u`.

## Active Surface

- Route/page/overlay/flow/CTA group: Disks Drive A readonly mount/eject reliability verification and cleanup.
- Product action path: existing `c64scope` runners using `DroidmindClient`; product key input must use `DroidmindClient.pressKey()`.
- Raw ADB scope: infrastructure identity, APK install, log capture, package metadata, and bootstrap checks only.

## Exhaustive Inventory Counts

- Runtime CTAs discovered on `515e2818ed19`: `290` discovery-only rows. Route counts: Home `106`, Play `24`, Disks `40`, Config `28`, Settings `74`, Docs `18`.
- Runtime CTAs executed on current `af2d795b2361`: targeted Disks mount/eject proof only; no exhaustive final CTA ledger yet.
- Main flows proven on current `af2d795b2361`: readonly Drive A mount/eject single-cycle proof from no-disk state; app-visible target restore to `c64u`.
- Unaccounted runtime CTAs: `290` until final execution statuses are written; must finish at `0`.
- Untested main flows: Save-and-Connect, Home, Play, Disks, Config, Settings, Docs, Diagnostics, Device Switcher, Licenses, native pickers, touch parity, keypad-first, negative paths, lifecycle, performance, reliability, soak, cleanup.

## Remaining Untested CTAs

Unknown until all-route current-APK discovery completes. No discovered CTA may remain without a final row in `docs/testing/agentic-tests/full-cta-coverage/exhaustive-cta-ledger-3.md`.

## Remaining Untested Flows

- Current-SHA APK build/install/launch baseline.
- C64U app-driven Save-and-Connect.
- All-route clean-state discovery.
- All-route CTA execution, touch pass, keypad-first pass.
- Gate 3, Gate 4, Gate 5, Gate 6, Gate 6.5, Gate 7, and keypad canary re-run or superseded with deeper evidence.
- Home, Play, Disks, Config, Settings, Docs/Licenses, Diagnostics, Device Switcher, native picker deep dives.
- Negative-path matrix, lifecycle matrix, performance timings, reliability repetitions, background playback, soak.
- Cleanup and final state diff.

## Current Blockers

- Generic `scope:cta` historically emitted discovery-only `CALIBRATION_ONLY` rows; use gate runners plus targeted DroidMind flows and augment runner support only when needed to keep every CTA accounted.
- Generic Gate 3 current-SHA run is blocked by runner navigation/scroll behavior after host-field editing; targeted app-driven Save-and-Connect supersedes it for product proof, and the runner gap must be documented.
- Gate 6 current-SHA runner hung during DroidMind hierarchy capture with the app stationary at Settings top; supersede with targeted route evidence and document as an infrastructure defect.
- Gate 6.5 Config block is overlay contamination from the Drive A mount sheet, not a Config outage.
- Gate 7 HTTP-port restore row blocked, but follow-up cleanup proved HTTP port was already `80` and app reconnected to `c64u`.
- Inherited missing prompt artifacts remain absent from the checkout: `final-report-2.md`, `cleanup-report-2.md`, `callback-8020-residual-risk.md`, and `cta-runner.md`.
- Open product defect from the prior continuation: broad C64U folder import `/USB2/test-data` stalled at `Scanning... 0 items`; keep as an S2 unless revalidated differently.
- S1 product/hardware-impact defect remains open but partially mitigated: original repeated Drive A readwrite mount/eject loop caused app-visible `Connection reset`; current code now pauses drive polling around mount/eject and manual Disks mounts request `readonly`. One clean current-build Pixel 4 cycle passed without target degradation. Five-cycle reliability remains `INCONCLUSIVE_NEEDS_REPLAY` because the repetition harness tapped a stale coordinate and did not exercise product mount/eject correctly.

## Concrete Next Command Or DroidMind Action

1. Capture final logcat for the successful clean readonly cycle and repetition harness failure if not already captured.
2. Update `S1-DISKS-MOUNT-EJECT-RESETS-C64U.md` with current-build fix verification: one clean pass, repetition inconclusive, no target reset observed, final target restored to `c64u`.
3. Re-run a corrected reliability loop only after replacing stale coordinate fallbacks with hierarchy-visible controls or screenshot-verified coordinates for the active surface; abort on first bad state.
4. If corrected Disks reliability passes, continue remaining exhaustive surfaces. If it fails, keep S1 open and do not issue a final Pixel 4 recommendation.

## Cleanup Requirements

- Restore saved device to `c64u` (currently app-visible `C64U` / `c64u` in `restore-c64u-final-state/home-after-c64u-final.png`).
- Restore host/password/HTTP/FTP/Telnet fields to `c64u`/redacted password/`80`/`21`/`23`.
- Stop playback and clear temporary playlists.
- Eject test disks and restore drive state where safe.
- Restore theme, display profile, orientation, fullscreen options, and every app-local or C64 config setting changed during the run.
- Restore every C64 config value changed during the run.
- Export final diagnostics, capture final screenshot/hierarchy, confirm app-visible connected state, and write `cleanup-report-3.md`.
