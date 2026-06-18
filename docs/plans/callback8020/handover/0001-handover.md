# Handover 0001 — Callback 8020 support

> Paste this whole file as the prompt for a fresh Claude Code session in this
> repo (`/home/chris/dev/c64/c64commander`). It continues the Commodore Callback
> 8020 / Sailfish OS support effort. When done, update
> [`backlog.md`](backlog.md) and write `0002-handover.md` (see
> [`README.md`](README.md) for the progression model).

## Context

C64 Commander now ships a focused, Android-only **C64U Remote** variant
(`uk.gleissner.c64uremote`) designed for the keypad-first, no-Google Commodore
Callback 8020 (Sailfish OS Android AppSupport). The foundation is built and
broadly verified; this thread of sessions drives it to feature-complete and
bug-free in small steps.

**Read first:** `docs/plans/callback8020/touch-free-and-sailfish-support.md`,
`sailfish-callback-8020-android-compatibility.md`,
`sailfish-callback-8020-emulation.md`, `keymap.md`, and this folder's
`README.md` + `backlog.md`; skim root `PLANS.md` / `WORKLOG.md`.

## Verified state (as of this handover)

- Android-only variant + migration + feature pruning (all 12 flags disabled+hidden;
  HVSC/Online Archive Settings cards gated) — unit-tested.
- Both APKs build via `node scripts/build-android-apks.mjs --target ci --verify-metadata`;
  metadata + no-GMS gates pass; c64u-remote APK ships **only INTERNET** (manifest swap).
- T9/keypad input subsystem (`src/lib/input/`) + `useT9Input` wired to device name + host/IP.
- Small-screen: Playwright `callbackSmallScreen.spec.ts` passes (no overflow at 480×640 / 320×480).
- Device validation on a physical de-Googled (no-GMS) Pixel 4: install + coexist + launch +
  "C64U Remote" name + pruned features absent + keypad-only operable + no GMS/fatal.
- **Waydroid VANILLA (no-GMS) smoke PASS**: C64U Remote installed + launched + verified via
  `scripts/waydroid-smoke.sh run` (headless `kwin_wayland --virtual`; self-contained,
  `WAYDROID_SMOKE_DISABLE=1` toggle; opt-in non-blocking CI workflow).
- `package.json`/`package-lock.json` bumped to `0.8.8-rc2` to match the latest tag.

## This session's scope (Milestone M1 — make the gates green and durable)

1. **Confirm "Web | Unit tests (coverage)" is green on HEAD.** The prior CI failure was
   `tests/unit/scripts/releaseVersionMetadata.test.ts` (Received `0.8.8-rc1`, Expected
   `0.8.8-rc2`) from a pre-bump commit; HEAD has the `rc2` bump. Run `npm run test:coverage`
   and verify 0 failed tests. Then verify the **91% line/branch coverage gate** still holds
   with the new `src/` code — if it regressed, add targeted tests (likely candidates:
   `useT9Input` external-value reconciliation branch, `t9.ts` mode/cursor edges,
   `focusController` wrap/disabled paths). Do NOT lower the gate.
2. **Triage the perf-budget log lines** seen in that CI job ("Android HVSC perf budgets
   FAILED: T1 25000>20000", "browseLoadSnapshotMs: invalid budget value not-a-number"):
   confirm they are benign console output / runner-speed (the run reported exactly 1 failed
   test = the version test), or fix the budget config. Document the conclusion in `backlog.md`.
3. **Green the standard gates** on HEAD: `npm run lint`, `npm run test`, `npm run variant:check`,
   `npm run feature-flags:check`.

(If all of M1 is already green quickly, pull the top unchecked M2 item — keyboard-only CTA
coverage — and start it, but keep the session bounded.)

## Guardrails

- Keep the main `README.md` free of any Callback 8020 / Sailfish / C64U Remote references;
  all such docs live only under `docs/plans/callback8020/`.
- Do not regress the full `C64 Commander` variant. Never overstate validation: keep
  "designed for / validated against constraints" unless run on real Sailfish/Callback hardware.
- No skipped tests, no lowered gates, fix root causes. The stale-name guard
  (`npm run lint:stale-names`) must stay green (no `c64u-controller` in active outputs).
- Waydroid/emulator runs are non-blocking; never let them gate the main build.

## Definition of done for this session

- M1 items above verified green (with the commands run + output captured).
- `backlog.md` updated (tick/expand items; record the perf-budget conclusion).
- Write `0002-handover.md` carrying the new verified state + the next 1–3 backlog items.
