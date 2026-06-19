# Prompt 1 — Conclusive fix for the C64U Remote MVP

> Implementation prompt to resolve every finding in
> [`review1.md`](review1.md) **plus** two branding issues, while keeping the
> C64U Remote variant introduction **targeted, small, and MVP-first**.
>
> You are implementing on branch `feat/introduce-new-variant`. Do not start a
> new feature; finish this one cleanly.

## 0. Guiding principle — read before touching anything

**The C64U Remote MVP is the existing app, reskinned, Android-only, driven by
touch + the standard Android soft keyboard.** Nothing else.

- The device has a working touchscreen, so the system soft keyboard (IME)
  already covers IP / hostname / port / password entry on a 480×640 screen.
  Therefore **all keypad / T9 / focus-navigation mechanism is non-essential for
  the MVP and is deferred to post-MVP.**
- "Defer" means **hide the existing keypad/T9 input behind a user-visible
  feature flag that is OFF by default and marked _experimental_, and leave the
  code (and its passing unit tests) intact** — do **not** delete the input
  subsystem. It is already built and tested; ripping it out is needless churn.
- **Keep untouched** the parts that age well: small-screen responsiveness
  (display profiles, Playwright overflow gate), the Android-only manifest/build
  selection, the no-GMS gate, and the variant / feature-flag plumbing.
- **No new scope.** If a change is not in *Part A* below and is bigger than a
  couple of lines, it belongs in *Part B* (document-only). When in doubt, prefer
  the smaller change.

Work top-to-bottom. Commit in small, logically-grouped commits. Run the
[validation gate](#4-validation-gate) before declaring done.

---

## 1. Part A — DO NOW (MVP-blocking)

### A1. Gate the existing keypad/T9 input behind a user-visible, default-off, experimental feature flag  [P0, correctness]

**Problem (review §4.2):** `useT9Input` is wired unconditionally into the shared
`SavedDeviceEditorFields`, which renders in `SettingsPage.tsx:1053` and
`DiagnosticsDialog.tsx:903` — present in **all** variants, including the main
`c64commander` web and iOS builds. A test asserts that typing `2` in the device
**name** field yields `a` (multi-tap), and `#` silently flips the composer mode.
Any hardware-keyboard user therefore cannot type digits into that field. The
parallel focus-navigation feature was variant-gated; T9 was not.

**Fix — one user-visible experimental feature flag, OFF by default.** Use the
existing feature-flag system (do not introduce a bespoke constant). The
authoritative registry is `src/lib/config/feature-flags.yaml`; the
`experimental` group already exists, and standard-user toggleability is derived
as `visible_to_user && !developer_only`.

1. Add the flag to `src/lib/config/feature-flags.yaml` (mirror the existing
   schema exactly):
   ```yaml
     - id: keypad_input_enabled
       enabled: false
       visible_to_user: true
       developer_only: false
       group: experimental
       title: Keypad / T9 input
       description: >-
         Experimental. Drive the app with a physical keypad (D-pad navigation
         and activation) and enter text in fields via T9 multi-tap, for devices
         without a usable touchscreen. Leave off when using touch and the
         on-screen keyboard.
   ```
   Then regenerate the registry: `npm run feature-flags:compile` (writes
   `src/lib/config/featureFlagsRegistry.generated.ts`). The row then appears
   under **Experimental Features** in Settings, off by default, for every
   variant. **Do not** add it to the `variants/feature-flags/c64u-remote.yaml`
   disable overlay — on the keypad device this is the one experimental feature
   that must stay user-visible so it can be opted into.
2. **Read the flag at runtime** via `useFeatureFlags()` (`flags.keypad_input_enabled`):
   - **Focus navigation** (`src/App.tsx`): have `KeypadFocusNavigation` read the
     flag and set `enabled={flags.keypad_input_enabled}` on
     `FocusNavigationProvider`, replacing the build-time
     `keypadFocusNavigationEnabled = variant.appId === "c64u-remote"` gate.
     (`KeypadFocusNavigation` renders inside `FeatureFlagsProvider` — verify the
     provider order holds; it does.) With the flag off, the global key listener
     stays detached and the `useFocusItem` calls across shared components remain
     harmless no-ops — **leave those calls in place**.
   - **T9** (`src/components/devices/SavedDeviceEditorFields.tsx`): add an
     optional prop `keypadInput?: boolean` (default `false`) and pass it to
     `useT9Input({ ..., enabled: keypadInput })` for both the name and host
     fields. The two call sites (`SettingsPage.tsx:1053`,
     `DiagnosticsDialog.tsx:903`) pass `keypadInput={flags.keypad_input_enabled}`
     (`flags` is already available there, or add `useFeatureFlags()`). Keeping it
     a prop — rather than reading the flag inside the shared component — keeps the
     component decoupled and unit-testable.

**Tests:**
- `tests/unit/components/devices/SavedDeviceEditorFields.t9.test.tsx`: render the
  field with `keypadInput` explicitly `true` (the test proves the gated feature
  still works), preserving composer-wiring coverage.
- `tests/unit/lib/input/t9.test.ts` and `tests/unit/hooks/useT9Input.test.tsx`
  test the lib/hook directly with T9 enabled — leave them as-is.
- The `*.focus.test.tsx` files mount their own `FocusNavigationProvider` with
  `enabled` set locally, so they are unaffected by the App-level gate — verify,
  don't change.
- Add a small test asserting `keypad_input_enabled` defaults off and is
  user-visible in the `experimental` group (mirror an existing flag-registry
  test if one exists).

**Done when:** with the flag at its default (off), focusing the device name/host
fields and typing digits inserts the literal digits (no multi-tap, no mode flip)
on every variant/platform; toggling the **Experimental ▸ Keypad / T9 input**
switch on re-enables the composer; `npm run test` and `npm run feature-flags:check`
are green.

### A2. Template hard-coded app-name strings  (issue 1)

**Goal:** user-facing copy must show the **active variant's** name, never a
hard-coded "C64 Commander".

- Use `import { variant } from "@/generated/variant"` and substitute
  `variant.displayName` (`"C64 Commander"` / `"C64U Remote"`).
- Known occurrences: `src/pages/DocsPage.tsx:33` and `src/pages/DocsPage.tsx:365`.
- Sweep for the rest and fix every **rendered** occurrence:
  ```
  grep -rn "C64 Commander" src/ --include=*.tsx --include=*.ts
  ```
  **Exclude (do NOT touch):** the GPL license-header comment lines
  (`C64 Commander - Configure and control your Commodore 64 Ultimate ...`),
  anything under `src/generated/**` (auto-generated — those values are already
  per-variant from `variants.yaml`), and code comments (e.g. `App.tsx:201`).
- Update any unit test that asserts the literal string to assert
  `variant.displayName` instead.

**Done when:** DocsPage (and any other screen found) renders the active
variant's name; the grep above shows only license headers / generated files /
comments remaining.

### A3. Home header — restore the logo + "Home" label (regression)  (issue 2)

**Corrected requirement:** the Home page top-left must show **the app logo, with
the page title "Home" to its right** — exactly as on `main`. This must hold for
**every** variant, including C64U Remote on its small screen. (Any earlier
guidance to drop the text is superseded: do **not** remove the label.)

**Context:** `AppBar` renders its `leading` slot if provided, else
`<h1>{title}</h1>` (`src/components/AppBar.tsx:84`). On Home, `leading` is the
logo `<img src={variant.assets.public.homeLogoPng}>` **plus**
`<h1 data-testid="home-header-title">Home</h1>` (`src/pages/HomePage.tsx:1056-1069`).
This block is **identical to `main` across the whole branch** — the only
`HomePage.tsx` diffs are unrelated `focusId`/`focusOrder` props. So if C64U
Remote renders differently, the cause is **not** this JSX. Build and run the
C64U Remote variant and compare to `main`; the likely culprits, in order:

  1. **Missing per-variant logo asset.** `homeLogoPng` resolves to `/c64u-remote.png`,
     generated by `scripts/generate-variant.mjs` from `variants/assets/c64u-remote/logo.png`.
     Confirm `APP_VARIANT=c64u-remote npm run variant:generate` actually writes
     `public/c64u-remote.png` and that the running C64U Remote build serves it —
     a missing asset means no logo. (Asset generation is **not** gated on a `web`
     block, so it should produce it; verify the build/dev pipeline does so for
     the active variant.)
  2. **Small-screen layout** (480×640 compact profile) truncating/hiding the
     `truncate`d `<h1>` or oversizing the logo so the label has no room. If so,
     adjust the header layout so the logo **and** "Home" both stay visible at
     480px (and 320px) — without removing the label — and keep the Playwright
     overflow gate (`playwright/callbackSmallScreen.spec.ts`) green.

**Per-variant logo (verify + document — the mechanism already exists, do not
rebuild it):**
- The C64U Remote logo source is `variants/assets/c64u-remote/logo.png` (a
  stylized C64), currently byte-identical to the C64 Commander artwork. Dropping
  a different file there and running `npm run variant:generate` changes **only**
  the C64U Remote logo.
- Confirm nothing hard-codes `/c64commander.png` (or any literal logo path):
  `grep -rn "c64commander.png\|homeLogoPng" src/` — every consumer must read
  `variant.assets.public.homeLogoPng`.
- Add one line to the touch-free / Sailfish doc (or the variant asset notes)
  stating how to swap the C64U Remote logo (replace the source artifact +
  regenerate). **Do not create new artwork now** — the requirement is only that
  it *can* be swapped.

**Done when:** the C64U Remote Home page shows the logo + "Home" label (matching
`main`), the logo is sourced from the variant's own artifact and provably
swappable, and the small-screen overflow gate stays green.

### A4. Cheap safety / hygiene (small, do now)

- **ios.yaml latent crash (review §4.5):** `.github/workflows/ios.yaml` reads
  `config.variant.platform.ios.bundleId` at lines `80`, `183`, `734` without a
  guard. Now that `platform.ios` is optional, add `?.` plus a clear skip-or-fail
  for an Android-only variant (e.g. fall back to a guarded error message). The
  iOS lane only builds the default variant today, so this is latent — but it is a
  one-line-each safety fix.
- **Move agent-loop scratch out of `docs/plans/` (review §4.6):** the loop-state
  files are not durable docs. `git rm` (or `git mv` into the git-ignored
  `docs/agentic/callback8020/`) the numbered handovers
  `docs/plans/callback8020/handover/0001..0009-*.md`,
  `docs/plans/callback8020/handover/backlog.md` (after copying any still-relevant
  deferred items into the Part B backlog), and
  `docs/plans/callback8020/ralph/STATE.md`. **Keep** the durable docs under
  `docs/plans/callback8020/`: the compatibility review, emulation guide,
  `touch-free-and-sailfish-support.md`, `keymap.md`, and `reviews/`. Keep
  `ralph/*.prompt.md` only if it is a reusable prompt; otherwise move it too.

> Note: `check-stale-variant-names.mjs` is wired into `npm run lint`
> (`lint:stale-names`). **Do not remove it** — retiring it is a Part B item.

---

## 2. Part B — DEFER (document only; do NOT implement now)

Record these in the post-MVP backlog (recreate a short
`docs/plans/callback8020/handover/backlog.md` containing only forward-looking
items, or append to PLANS.md). Reference the `keypad_input_enabled` flag so they
are easy to pick up later:

- **Keypad / T9 feature completion** — finalize against real device key codes,
  validate on hardware, then (optionally) default `keypad_input_enabled` to
  `enabled: true` for C64U Remote via its `variants/feature-flags/c64u-remote.yaml`
  overlay once it is no longer experimental.
- **Replace the guessed `commodoreCallback8020` key codes** with captured ones;
  add per-binding parity tests (review §4.3, §4.7).
- **Double-activation handling** — native `Enter`/`Space` on a focused button vs.
  the controller's `activate()` → `element.click()` (review §4.3).
- **Per-CTA focus-ring registration completeness** (review §4.3).
- **`android_only: true` schema flag** to consolidate the Android-only
  enforcement now spread across schema/manifest/capacitor/CI (review §4.1).
- **Doc citations** — add a Sources section to the Sailfish compatibility review
  and an inline "unvalidated on hardware" caveat to the `keymap.md` keycode table
  (review §4.6).
- **CI hygiene** — pin or replace the unpinned `curl … | bash` Waydroid installer
  in `scripts/waydroid-smoke.sh:76` (review §4.5); retire
  `check-stale-variant-names.mjs` once the rename has fully settled (review §4.1).

---

## 3. Constraints / do-not-touch

- Do not delete the `src/lib/input/**` subsystem, `useT9Input`,
  `useFocusNavigation`, or their unit tests — they are dormant, not dead.
- Do not modify the responsiveness work (`displayProfiles`,
  `smallScreenLayout.test.ts`, `callbackSmallScreen.spec.ts`), the Android-only
  manifest/build selection, or the no-GMS gate.
- No new runtime dependencies. No new user-facing features.
- Keep `variant.displayName` / `variant.assets.public.homeLogoPng` as the single
  sources of truth for name and logo — never reintroduce hard-coded values.

---

## 4. Validation gate (must pass before "done")

```
npm run feature-flags:compile      # regenerate the flag registry after adding keypad_input_enabled
npm run lint          # eslint + variant:check + feature-flags:check + stale-names + display-profiles
npm run test          # vitest unit suite
npm run variant:generate           # default (c64commander) — regenerate assets/config
APP_VARIANT=c64u-remote npm run variant:generate   # Android-only variant generates cleanly + writes public/c64u-remote.png
npm run build         # default variant builds
```

Then manually confirm (default + c64u-remote):
- With **Experimental ▸ Keypad / T9 input** at its default (off): typing digits
  in the device **name** and **host** fields inserts the literal digits (no T9
  multi-tap, no silent mode switch). Toggling it on re-enables the composer.
- The Home page top-left shows the **logo + "Home" label** on both variants —
  on C64U Remote it matches `main` (logo present, label visible at 480px).
- The Docs page (and any other swept screen) shows the active variant's name.
- `grep -rn "C64 Commander" src/` returns only license headers, generated files,
  and code comments.

**Definition of done:** Parts A1–A4 implemented, Part B recorded as deferred, the
validation gate green, and the diff is small and focused — a reskinned,
Android-only, touch-first variant whose keypad/T9 input ships **off** behind a
user-visible experimental flag, whose Home header matches `main` (logo + label),
and with no hard-coded branding.
