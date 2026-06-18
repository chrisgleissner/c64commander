# C64U Remote variant + Sailfish/Callback 8020 compatibility (2026-06-18)

Authoritative execution plan for: introduce the Android-only **C64U Remote**
variant (migrated from the placeholder `c64u-controller`), make Android-only
variants first-class, have every normal Android build emit **both** the C64
Commander APK and the C64U Remote APK, prune C64U Remote to a stable local
remote-control feature set, and add a reusable T9 / hardware-key input
subsystem so the app is operable on the keypad-first Commodore Callback 8020
(Sailfish OS Android AppSupport, ~640×480 / 3.25").

> Branch: `feat/introduce-new-variant`. Prior `PLANS.md`/`WORKLOG.md` content
> (an unrelated, completed viewport/LED regression fix) is preserved in git
> history; both files are re-authored here for this task and kept current.

## Guiding constraints (from the brief)

- Display name exactly `C64U Remote` (uppercase `C64U`, capital `R`, one ASCII space).
- Android-only: **no** ios/web platform blocks; no ios/web artifacts produced.
- App id `uk.gleissner.c64uremote`; custom URL scheme `uk.gleissner.c64uremote`.
- Assets at `variants/assets/c64u-remote/...`; flags at `feature-flags/c64u-remote.yaml`
  (repo path `variants/feature-flags/c64u-remote.yaml`).
- Default variant stays `c64commander`. Android publish/CI matrix must include both.
- No Google Play Services hard dependency. Local cleartext HTTP must work.
- No stale `c64u-controller` / `C64U Controller` / `c64ucontroller` / `uk.gleissner.c64ucontroller`
  in active outputs (history/migration notes only).
- Do NOT overstate: say "designed for / validated against Callback 8020 constraints"
  unless validated on real hardware/AppSupport (we cannot — no device available).
- No suppressed warnings, no skipped/lowered gates, fix root causes.

## Phases & tasks

| Phase | Task | Acceptance |
| ----- | ---- | ---------- |
| P0 | PLANS.md + WORKLOG.md authored; repo variant/build/flag/route systems mapped | Docs exist; system map captured in WORKLOG |
| P1 | Verify current public Callback 8020 / Sailfish AppSupport facts vs the baseline | Findings + sources recorded; baseline corrected where needed |
| P2 | Compatibility review skeleton at `docs/research/callback8020/sailfish-callback-8020-android-compatibility.md` | File exists with all required sections |
| P3 | Make Android-only variants first-class: variant schema/validator allows a variant with only `platform.android` (no ios/web); generator + asset + capacitor + manifest paths tolerate missing ios/web | `variant:check` green for Android-only; schema rejects a variant missing android when android is required |
| P4 | Migrate `c64u-controller` → `c64u-remote`: variants.yaml entry (Android-only), assets dir, feature-flag override file, publish_defaults matrix; remove all stale `c64u-controller` active references | Repo-wide search shows no active stale refs; `variant:generate` works for c64u-remote |
| P5 | C64U Remote feature policy: `feature-flags/c64u-remote.yaml` disables hvsc, commoserve, demo_mode, and all experimental flags; verify route + nav + settings gating prevents reaching disabled features (direct URL, stale localStorage, hidden menu, deep link) | Flag compile green; gating verified by tests |
| P6 | Build matrix: normal Android build produces both APKs with deterministic, distinguishable basenames; build log shows variant→APK mapping; `package.json`/`build` updated | Local build produces both APKs (or documented gap if SDK unavailable) |
| P7 | CI: android workflow builds + uploads both APKs; runs variant/flag validation; asserts APK metadata (label/app id); stale-name guard | Workflow updated; steps named and documented |
| P8 | T9 / hardware-key input subsystem under `src/lib/input/` (key normalization, semantic action model, keymap registry, T9 composer, focus/nav controller, profiles incl. commodoreCallback8020 + dev) | Subsystem implemented; unit tests pass |
| P9 | Wire hostname/IP entry + general text fields to T9 fallback; keyboard-only CTA/focus navigation for primary screens | Connection setup completable without soft keyboard; CTA reachable/activatable by keys (tested) |
| P10 | Small-screen layout checks at 480×640, 640×480, 360×480, 320×480 (no horizontal overflow; reachable CTAs) | Layout tests pass |
| P11 | Full validation: unit, typecheck, lint, variant/flag compile, stale-name search, APK build + metadata; update review doc with real evidence | All gates green; doc has real findings + risk table |
| P12 | Finalize PLANS.md / WORKLOG.md; final summary with exact evidence | Termination criteria satisfied |

## Acceptance criteria (termination)

See the brief's TERMINATION CRITERIA — tracked in the checklist below.

- [x] PLANS.md current
- [x] WORKLOG.md current
- [x] `docs/research/callback8020/sailfish-callback-8020-android-compatibility.md` with real findings
- [x] `c64u-remote` is the active secondary variant; `c64u-controller` not active
- [x] User-visible name exactly `C64U Remote`
- [x] C64U Remote Android-only (no ios/web outputs)
- [x] Every normal Android build produces both APKs (built + metadata-verified locally)
- [x] C64U Remote excludes immature + unrelated features (flag overlay disables+hides all 12; baked pre-override → no stale-state/direct-route bypass)
- [x] Feature-flag overrides tested
- [x] T9 fallback for text inputs (hook); hostname/IP entry without soft keyboard (tested)
- [x] Primary CTAs operable via physical-key semantics (native focus + default keymap; FocusController foundation) — full per-CTA registration noted as incremental
- [x] Small-screen layout tests cover 480×640 and a narrower fallback (320×480)
- [x] APK metadata checks pass (label + app id for both APKs)
- [x] CI/build scripts updated; all my tests + lint green (1 pre-existing, unrelated failure — see Status)
- [x] Risks documented without exaggeration

## Risk notes / assumptions

- **No Callback 8020 hardware and no Sailfish AppSupport environment available.**
  All Sailfish/Callback claims are "designed for / validated against constraints",
  never "validated on hardware". This is the single largest residual risk.
- Android SDK availability for a real local APK build is unverified at P0; if the
  toolchain is present we build both APKs and inspect metadata, otherwise we
  document the exact gap and provide the deterministic command that would run in CI.
- We prefer **variant-aware feature gating + route composition** over forking the UI.
- We keep the full C64 Commander variant unchanged except for shared, beneficial fixes.

## Status

- **Complete (P0–P12).** All phases done and validated locally.
  - Android-only variants are first-class (generator + schema + tests). `c64u-controller`
    migrated to the Android-only `c64u-remote` (`C64U Remote`, `uk.gleissner.c64uremote`).
    No stale `c64u-controller` naming in active outputs (guard enforces this).
  - C64U Remote disables + hides all 12 feature flags (internet-content + experimental).
  - Both Android APKs built locally and metadata-verified
    (`c64commander` → `C64 Commander` / `uk.gleissner.c64commander`;
    `c64u-remote` → `C64U Remote` / `uk.gleissner.c64uremote`). CI builds + uploads + verifies both.
  - T9 / keypad input subsystem (`src/lib/input/`) + React adapter wired into the
    host/IP + device-name fields; IPv4/hostname entry without the soft keyboard (tested).
  - `npm run lint` green; full unit suite **6941 passed**.
  - The previously pre-existing `releaseVersionMetadata.test.ts` failure is now FIXED
    (bumped `package.json`/`package-lock.json` to `0.8.8-rc2` to match the latest tag).

## Continuation phase — substitute validation + remaining follow-ups (complete)

- **Version bump** `0.8.8-rc2` → release-metadata test passes (full suite green).
- **C64U Remote permission scoping (was Low risk → RESOLVED):** variant-driven manifest
  swap (`AndroidManifest.no-background.xml`); c64u-remote APK ships **only INTERNET**
  (verified via `aapt2 dump permissions`); parity test guards drift.
- **Settings pruning extended:** HVSC + Online Archive cards gated on their flags
  (+ tests); confirmed absent on-device for c64u-remote.
- **No-GMS gate:** `verify-apk-no-gms.mjs` (+ npm script, wired into `android:apk:all`);
  both APKs pass; validated on a no-GMS device.
- **Sailfish-like mock-env tooling:** `scripts/sailfish-callback-emulator.sh` (AOSP no-GMS
  480×640 AVD), `scripts/android-keypad-smoke.sh`, `docs/research/callback8020/sailfish-callback-8020-emulation.md`
  (Waydroid VANILLA as the closest LXC analog + AOSP emulator + Pixel 4 layering).
- **Real-browser layout (was Low risk → RESOLVED):** `playwright/callbackSmallScreen.spec.ts`
  passes — no overflow at 480×640 and 320×480 across all routes.
- **Device validation on a physical de-Googled Pixel 4 (no GMS):** both APKs install +
  coexist + launch; "C64U Remote" name confirmed; pruned features absent; keypad-only
  operability PASS; no GMS/fatal errors. Evidence in `artifacts/android-apks/validation/`.
- **Remaining genuinely external:** real Sailfish AppSupport / Callback 8020 hardware
  (pre-release) — substitutes documented for when a binder kernel + Wayland host / the
  device is available.
