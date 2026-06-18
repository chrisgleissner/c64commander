# Callback 8020 support — backlog & definition of done

Single source of truth for "feature-complete and bug-free" Callback 8020 /
Sailfish support. Milestones are ordered roughly by priority; each unchecked item
is sized to be (at most) one handover session. Tick items as sessions complete
them, and add new items as bugs/gaps are discovered.

Legend: `[x]` done & verified · `[~]` partial · `[ ]` todo.

## Done so far (foundation — verified)

- [x] Android-only variant support in the generator (optional iOS/web, resolved `theme`), with tests.
- [x] `c64u-controller` → `c64u-remote` migration (`C64U Remote`, `uk.gleissner.c64uremote`, Android-only); publish matrix includes both; stale-name guard.
- [x] Feature pruning: all 12 flags `enabled:false, visible_to_user:false` for c64u-remote; HVSC + Online Archive Settings cards gated; cannot be re-enabled by user/localStorage (baked pre-override).
- [x] Both APKs from one build (`android:apk:all`) + deterministic names + metadata check + no-GMS gate; CI builds/uploads/verifies both.
- [x] Per-variant permission scoping: c64u-remote APK ships **only INTERNET** (manifest swap + parity test).
- [x] T9 / keypad input subsystem (`src/lib/input/`) + `useT9Input` wired into device name + host/IP fields; 53+ tests.
- [x] Small-screen layout: jsdom profile contract + real-browser overflow at 480×640 & 320×480 (Playwright).
- [x] Docs: compatibility review, emulation guide, touch-free/Sailfish doc, keymap — all under `docs/plans/callback8020/`; README kept free of variant references.
- [x] Device validation on a physical de-Googled (no-GMS) Pixel 4: install + coexist + launch + "C64U Remote" name + pruned features absent + keypad-only operable + no GMS/fatal.
- [x] Waydroid VANILLA (no-GMS, closest Sailfish analog) smoke: C64U Remote installed + launched + verified (PASS) via `scripts/waydroid-smoke.sh` (self-contained, toggleable, opt-in CI).

## M1 — CI / quality gates green and durable

- [ ] Confirm "Web | Unit tests (coverage)" green on HEAD (rc2 bump fixes the version test) and the 91% line/branch coverage gate holds with the new `src/` (input subsystem, `useT9Input`, Settings/host wiring); add targeted tests for any uncovered branches (e.g. `useT9Input` reconciliation branch, `t9` mode edges, `focusController` wrap/disabled).
- [ ] Triage the HVSC perf-budget log lines ("T1 25000>20000", "browseLoadSnapshotMs not-a-number"): confirm benign/runner-speed (not a real regression) or fix the budget config; document the conclusion.
- [ ] Ensure `npm run lint`, `npm run test`, `variant:check`, `feature-flags:check` are all green on HEAD and in CI.

## M2 — Keyboard-only operability completeness (touch-free)

- [ ] Audit every primary CTA on Home/Play/Disks/Config/Settings for keyboard/d-pad reachability + activation; register the ones needing deterministic order through `FocusController`.
- [ ] Deterministic `back` behaviour wiring (close dialog → leave menu → leave field → navigate back) verified per screen.
- [ ] Soft-key (`softLeft`/`softRight`) → context actions where the device exposes them; map and test.
- [ ] Destructive confirmations: safe default focus + cannot be triggered by repeated T9 input; keyboard-only confirm/cancel.
- [ ] Sliders/toggles/selects operable via `dpadLeft/Right` + `activate`; add tests.
- [ ] On-device proof: drive a full connect→play flow with hardware keys only (no taps) on the Pixel 4 / Waydroid (root) and capture evidence.

## M3 — T9 text-input completeness

- [ ] Audit ALL text inputs in the c64u-remote surface (not just device name/host) and attach `useT9Input` (or confirm not reachable in the variant).
- [ ] Visible input-mode indicator (multitap vs hostname) + how to switch (`#`), on the small screen.
- [ ] Settings/developer UI to select the input profile (`defaultKeyboard` ↔ `commodoreCallback8020`) since AppSupport auto-detection is unreliable.
- [ ] On-device T9 entry visual proof: focus the host field via keypad and enter `192.168.1.13` with a screenshot (needs root waydroid shell / authorized adb / real keypad).

## M4 — Small-screen UX polish (480×640 first)

- [ ] Extend overflow/layout checks to 640×480 landscape + assert dialogs/toasts/bottom-sheets/dropdowns fit within the viewport.
- [ ] High-contrast, always-visible focus outline at 480×640; no focus trapped off-screen; no scroll traps for critical controls.
- [ ] Connection setup screen reviewed for tiny-screen task-first layout; status/error messages short + actionable.

## M5 — Sailfish/AppSupport substitute coverage (CI + deeper)

- [ ] Make the Waydroid CI job capture the deeper smoke (resumed activity + screenshot + logcat) on the passwordless-sudo runner; attach evidence; keep it non-blocking.
- [ ] Actually exercise the AOSP no-GMS 480×640 emulator (`scripts/sailfish-callback-emulator.sh`) end-to-end at least once; record results/limits.
- [ ] Validate cleartext HTTP to a mock device server from inside Waydroid/emulator (host LAN IP / `10.0.2.2`); confirm mDNS/`.local` does NOT resolve and the raw-IP path is sufficient.
- [ ] Decide on an mDNS/`.local` fallback (resolver or documented "manual IP only") and implement/document.

## M6 — Real-hardware validation (external; unlocks wording upgrade)

- [ ] Run the §11 manual checklist on a real Sailfish OS AppSupport device; record WebView version + behaviour.
- [ ] Run it on real Commodore Callback 8020 hardware (post-ship); confirm install/sideload path, touch-off keypad UX, cleartext LAN.
- [ ] Only then change docs from "designed for / validated against constraints" to "validated on Sailfish/Callback".

## M7 — Bug-free hardening

- [ ] AppSupport lifecycle: flip close/open, screen lock, process kill, container freeze/restart — verify no broken state in c64u-remote.
- [ ] Error/dropout UX on the tiny screen (device unreachable, timeouts, concurrent REST) — short, actionable, keyboard-dismissible.
- [ ] Regression sweep of the c64u-remote surface for any stray immature/internet features reachable by deep link / stale state.
- [ ] `targetSdk 35` behaviour spot-check on an API-33 image (AppSupport ceiling).
