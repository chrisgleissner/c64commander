# Callback 8020 / C64U Remote — post-MVP backlog

Forward-looking work, deferred out of the C64U Remote MVP. The MVP ships the
existing app reskinned, **Android-only, touch-first** (touchscreen + the system
soft keyboard cover all text entry on the 480×640 panel). The keypad/T9 input
subsystem is fully built and unit-tested but ships **behind the user-visible,
default-off experimental feature flag `keypad_input_enabled`** (Settings ▸
Experimental Features ▸ *Keypad / T9 input*). Everything below is picked up from
there.

Legend: `[ ]` todo · `[~]` partial.

## Keypad / T9 — finish against real hardware (gated by `keypad_input_enabled`)

- [ ] **Keypad / T9 feature completion.** Finish the touch-free path (per-screen
  CTA reachability audit, deterministic `back` chain wired to real dialogs/menus/
  fields, soft-key context actions, slider/select operability via d-pad), validate
  on real hardware, then — once it is no longer experimental — optionally default
  `keypad_input_enabled: true` for C64U Remote via its
  `variants/feature-flags/c64u-remote.yaml` overlay. (See the prior loop state
  under `docs/agentic/callback8020/handover/backlog.prev.md` for the detailed
  M2–M7 breakdown.)
- [ ] **Replace the guessed `commodoreCallback8020` key codes** with codes
  captured from real hardware, and add per-binding parity tests for the non-d-pad
  bindings (soft keys, back, call, menu). (review §4.3, §4.7)
- [ ] **Double-activation handling.** A focused button can receive both the
  native `Enter`/`Space` activation and the controller's `activate()` →
  `element.click()`. On real hardware the OK key emits `DPAD_CENTER` (no native
  button activation), but under keyboard-driven emulation `Enter` may fire both.
  Add a guard + test before relying on emulator runs. (review §4.3)
- [ ] **Per-CTA focus-ring registration completeness.** Finish registering the
  remaining surfaces (Play/Disks pages, HomePage quick-config selects/sliders,
  Config per-category group actions, the rest of Settings) via `useFocusItem`,
  then a full per-screen reachability audit. (review §4.3)
- [ ] **T9 input mode UX.** Visible input-mode indicator (multitap vs hostname)
  and how to switch (`#`) on the small screen; a developer/settings control to
  pick the input profile (`defaultKeyboard` ↔ `commodoreCallback8020`) since
  AppSupport auto-detection is unreliable; audit all reachable text inputs.

## Schema / build consolidation

- [ ] **`android_only: true` schema flag** to consolidate the Android-only
  enforcement now spread across schema, manifest selection, capacitor fallback,
  and CI, so the constraint is validated in one place rather than emerging from
  the absence of `ios`/`web` blocks. (review §4.1)

## Docs

- [ ] **Doc citations.** Add a "Sources" section (URLs + access dates) to the
  Sailfish compatibility review for the AppSupport / no-Google-services / LXC
  claims, and an inline "unvalidated on hardware" caveat to the `keymap.md`
  keycode table so a scanning reader is not misled. (review §4.6)

## CI hygiene

- [ ] **Pin or replace the unpinned `curl … | bash` Waydroid installer** in
  `scripts/waydroid-smoke.sh:76` (supply-chain smell); prefer a pinned version or
  the distro package directly. (review §4.5)
- [ ] **Retire `check-stale-variant-names.mjs`** (`npm run lint:stale-names`)
  once the `c64u-controller` → `c64u-remote` rename has fully settled on `main`.
  (review §4.1)

## Real-hardware validation (external; unlocks wording upgrade)

- [ ] Run the manual checklist on a real Sailfish OS AppSupport device and on
  real Commodore Callback 8020 hardware; only then change docs from "designed for
  / validated against constraints" to "validated on Sailfish/Callback".
