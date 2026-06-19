# Review 1 — C64U Remote variant (`feat/introduce-new-variant`)

> Adversarial engineering review of the C64U Remote variant work on branch
> `feat/introduce-new-variant`, covering necessity, codebase impact, clean
> code, KISS, DRY, modularity, correctness, and long-term cross-platform
> maintainability. Includes a focused verdict on the small-screen keyboard /
> T9 question.
>
> Reviewer note: the requested output path `docs/plans/callbac8020/...` was a
> typo; this report is filed under the existing `docs/plans/callback8020/`
> tree.

## 1. Scope & method

Reviewed both the committed changes (3 commits, `git diff main...HEAD`) and the
substantial **uncommitted working-tree** changes on the branch, since the latter
contain the entire keypad focus-navigation subsystem and its spread across the
shared component layer. Coverage:

- Variant declaration & Android-only enforcement: `variants/variants.yaml`,
  `variants/feature-flags/c64u-remote.yaml`, `scripts/generate-variant.mjs`,
  `scripts/build-android-apks.mjs`, `scripts/verify-apk-no-gms.mjs`,
  `scripts/verify-apk-metadata.mjs`, `scripts/check-stale-variant-names.mjs`,
  `android/app/build.gradle`, `android/app/src/main/AndroidManifest.no-background.xml`,
  `capacitor.config.ts`, the CI workflows, and the smoke scripts.
- Input subsystem: `src/lib/input/*` (keyEvent, keymap, profiles, t9,
  focusController, focusNavigation), `src/hooks/useT9Input.ts`,
  `src/hooks/useFocusNavigation.tsx`, and the ~10 shared components now wired
  into the focus ring.
- Responsiveness: `tests/unit/lib/smallScreenLayout.test.ts`,
  `playwright/callbackSmallScreen.spec.ts`.
- Docs & tests under `docs/plans/callback8020/` and `tests/unit/**`.

## 2. Verdict summary

The work is, in isolation, **well-engineered**: the input subsystem is pure,
data-driven, and exhaustively unit-tested; the small-screen responsiveness work
is genuinely valuable and benefits every variant; the Android-only build/CI
enforcement is deliberate and largely sound. The author's documentation is also
unusually honest about what has and has not been validated on real hardware.

The central problems are **necessity/scope and one concrete correctness
regression**, not craft:

1. **A large, code-heavy keypad/T9 subsystem is built on the premise that the
   device has no usable touchscreen.** Per current product direction the
   touchscreen *is* available. Once that premise relaxes, the standard Android
   soft keyboard covers all text entry (IP/hostname/port/password) on this
   screen size, and T9 text composition becomes optional gold-plating rather
   than an enabler (see §3).
2. **T9 input is wired unconditionally into a shared component**, so it is live
   in the *main* C64 Commander variant on web and iOS too — a real regression
   for any hardware-keyboard user — even though the parallel focus-navigation
   feature was correctly gated to the variant (see §4.2). This is the single
   most important fix.
3. The keypad work is **premature**: the `commodoreCallback8020` key profile is
   explicitly a set of *guessed* key codes that cannot be validated until the
   device exists, so shipping it now carries near-certain rework cost (§4.3).

### Scorecard

| Dimension | Rating | One-line justification |
| --- | --- | --- |
| Necessity | ⚠️ Mixed | Responsiveness + Android-only enforcement: necessary. T9 + per-CTA focus ring: not required for the MVP given a working touchscreen. |
| Impact on codebase | ⚠️ Moderate | A new cross-cutting `input` subsystem + opt-in props threaded into ~10 shared components; additive but now permanent surface area. |
| Clean code | ✅ Strong | Small, well-named pure modules; thorough JSDoc; consistent license headers. |
| KISS | ⚠️ Mixed | Each module is simple, but the *aggregate* (T9 multi-tap + hostname mode + focus ring + back-chain + profiles) is a lot of mechanism for one unreleased device. |
| DRY | ✅ Good | Variant logic centralised; keymaps composed via `mergeKeymaps`; minimal duplication. |
| Modularity | ✅/⚠️ | Excellent internal separation (DOM-free cores + thin React adapters); but the keypad concern has leaked into many shared presentational components. |
| Correctness | ❌ One regression | Ungated T9 changes digit-key behaviour in the device-name field for all variants/platforms (§4.2). Plus latent CI assumption (§5). |
| Long-term cross-platform maintainability | ⚠️ At risk | Speculative key codes, scattered Android-only enforcement, and shell-heavy smoke tests will need ongoing care; the responsiveness/variant work ages well. |

## 3. The central question — screen size, soft keyboard, and whether T9 is needed

**Verdict: with a working touchscreen, T9 multi-tap text entry is NOT required
for this variant's MVP. The standard Android soft keyboard (IME) is the correct,
lower-risk way to enter an IP/hostname, ports, or any password on this device.**

The repo's own design docs put the panel at **3.25", 480×640**
(`touch-free-and-sailfish-support.md:117`,
`tests/unit/lib/smallScreenLayout.test.ts:17`). The defensible reasoning, all
from publicly established facts rather than any single source:

- **Android apps get the system IME for free.** Any Android text app — and a
  Capacitor app is an ordinary Android WebView — raises the platform soft
  keyboard whenever an editable `<input>` is focused and a pointer device is
  present. This is a universal platform behaviour, not something the app must
  build. If touch works, the soft keyboard works.
- **480×640 is comfortably above the proven floor for on-screen keyboards.**
  The entire first generation of touchscreen smartphones shipped usable
  on-screen keyboards on **HVGA (320×480)** panels (the original iPhone and the
  first Android handsets). 480×640 carries *more* pixels than those devices, so
  a soft keyboard is unquestionably feasible here; it occupies roughly the lower
  ~40–50% of the screen while the platform pans the focused field above it.
- **The app already proves its chrome fits this screen.** The new responsive
  display-profile work is verified — in a real browser — to produce **no
  horizontal overflow at 480×640 and even 320×480** across every primary route
  (`playwright/callbackSmallScreen.spec.ts`,
  `tests/unit/lib/smallScreenLayout.test.ts`). So the UI surrounding the
  keyboard is already known to lay out correctly at the target size.
- **Passwords are the worst case for T9 and the best case for the IME.** A
  "network password" needs full mixed-case + symbol coverage. T9 multi-tap is
  slow and error-prone for that, and this composer does not even expose a full
  symbol/upper-case set (only a single case-toggle and a fixed punctuation
  list, `t9.ts:78-95`). The system keyboard handles this trivially.

What this means for the work under review:

- The **physical keypad is a legitimate *alternative* input method** and has
  long-term value as an enhancement (no-touch operation is a nice differentiator
  on a keypad-forward device). But it is **not MVP-blocking** once touch is
  available, and it should not complicate or regress the touch path.
- If any part of the keypad work survives into the MVP, prioritise **d-pad
  navigation** (cheap, additive, genuinely useful for one-handed use) over **T9
  *text composition*** (the most code-heavy, most locale-fragile part, and
  exactly the part the soft keyboard already replaces well).
- Recommendation: **drop T9 from the MVP** (or hide it behind an explicit,
  off-by-default developer/accessibility toggle), and **defer the keypad profile
  until the device's real key codes are known.** Keep the soft keyboard as the
  primary text-entry path on all variants.

## 4. Detailed findings

### 4.1 Variant configuration & Android-only enforcement — mostly good

- ✅ The rename `c64u-controller` → `c64u-remote` and the move of `theme` to a
  top-level block (because the variant declares no `web` platform) is handled
  cleanly in `generate-variant.mjs:236-273`: `platform.android` is required,
  `ios`/`web` are optional, and a top-level `theme` block is **required** when no
  `web` block is present, with the same hex normalization applied. This is
  deliberate, well-commented, and not hacky.
- ✅ The feature-flag overlay (`variants/feature-flags/c64u-remote.yaml`)
  correctly sets each excluded feature **both** `enabled: false` **and**
  `visible_to_user: false`, baked at build time, so a stale local-storage
  override cannot re-enable it. Good defensive design.
- ✅ The `AndroidManifest.no-background.xml` (INTERNET-only) + the
  `androidManifestParity.test.ts` guard is a sound way to strip
  foreground-service/wake-lock permissions a background-restricted container
  forbids.
- ⚠️ **MINOR — Android-only enforcement is spread across ~5 layers** (schema,
  manifest selection in `build.gradle`, capacitor fallback, partial CI gating,
  runtime flags). It is correct and test-covered, but a future maintainer adding
  a third variant must understand all five. Consider an explicit
  `android_only: true` schema field so the constraint is validated in one place
  rather than emerging from the absence of `ios`/`web` blocks.
- ⚠️ **MINOR — `check-stale-variant-names.mjs` is a bespoke 90-line CI script to
  catch leftovers from a one-time rename.** It works, but it is maintenance
  surface for a migration that is essentially already complete; consider
  retiring it after the branch lands.

### 4.2 T9 text entry — well-built internally, but **ungated** (the key bug)

- ✅ `t9.ts` is a clean, pure, timer-free state machine; `useT9Input.ts` is a
  careful append-only adapter that lets non-composer keys (Backspace, arrows,
  Enter, Tab, letters) pass through. The unit tests (`t9.test.ts`, 41 cases) are
  exemplary and prove the canonical keystroke sequences.
- ❌ **MAJOR (correctness) — `useT9Input` is wired into the shared
  `SavedDeviceEditorFields` with no variant/enabled/profile gate**
  (`SavedDeviceEditorFields.tsx:39-48`). That component renders in
  `SettingsPage.tsx:1053` and `DiagnosticsDialog.tsx:903`, which exist in **all**
  variants. The main `c64commander` variant ships **web + iOS** platforms, so the
  composer is now live for desktop-web and iOS users.
  - Concrete consequence, asserted by the project's own test
    (`SavedDeviceEditorFields.t9.test.tsx:61-64`): typing **`2`** in the device
    **name** field yields **`a`** (multi-tap), and `#` silently switches the
    composer to hostname mode with no visible indicator. For any hardware-keyboard
    user of the main app, digit entry in the device-name field is broken.
  - Why this is the most important finding: the **parallel** focus-navigation
    feature *was* correctly gated (`App.tsx:206`,
    `keypadFocusNavigationEnabled = variant.appId === "c64u-remote"`). The T9
    side missing the equivalent gate is almost certainly an oversight, and the
    asymmetry is the tell.
  - Fix (small): pass `enabled={variant.appId === "c64u-remote"}` (and the
    keypad `profileId`) into both `useT9Input` calls, mirroring the focus-nav
    gate — or, per §3, drop T9 from the MVP entirely.

### 4.3 Keypad focus navigation — clean, gated, but premature & wide-reaching

- ✅ `focusController.ts` / `focusNavigation.ts` are DOM-free, well-tested
  (wrap-around, skip-disabled, deterministic back-chain), and the React adapter
  (`useFocusNavigation.tsx`) is properly **additive**: outside the provider, or
  with `enabled={false}`, registration is inert and the global key listener is
  detached. The integration props (`focusId`/`focusOrder` on `QuickActionCard`,
  `SectionHeader`, etc.) are opt-in and tastefully documented.
- ⚠️ **MAJOR (necessity/maintainability) — the `commodoreCallback8020` profile
  is explicitly guessed.** Its own header says it is "NOT validated on real
  hardware … each hardware key is bound by several plausible aliases"
  (`commodoreCallback8020.ts:9-13`). Shipping speculative key codes before the
  device exists guarantees a rework pass once real codes are captured. This work
  should be **deferred** until the key-code mapping is confirmed; the
  data-driven design at least makes that retune cheap.
- ⚠️ **MINOR (modularity) — a single-variant, unvalidated concern has leaked
  into ~10 shared presentational components.** Even though it is inert for the
  main variant, every future change to those components must now reason about
  focus-ring registration, and the main variant still pays the
  register/unregister churn at runtime. Acceptable as forward-looking infra, but
  it is real, permanent surface area added ahead of need.
- ⚠️ **MINOR (correctness, verify-on-device) — possible double-activation.**
  `useFocusItem` activates by calling `element.click()`
  (`useFocusNavigation.tsx:184-190`), while the active profile also binds
  `Enter`/`Space` to activate (inherited from `defaultKeyboard`). On real
  hardware the OK key emits `DPAD_CENTER` (keycode 23), which browsers do not
  treat as native button activation, so there is no double-fire. But under
  keyboard-driven testing/emulation of the variant, `Enter` on a focused
  registered button may fire **both** the native click and the controller's
  `activate()`. Worth a guard/test before relying on emulator runs.

### 4.4 Small-screen responsiveness — genuinely valuable (keep)

- ✅ The display-profile work (fluid `100%`/`100dvw` widths, ≤2-column action
  grids on compact, preserved gutters/insets) plus the jsdom contract test and
  the real-browser overflow gate at 480×640 / 320×480 is the **most broadly
  useful** part of this branch. It improves every variant and platform, not just
  the keypad device, and is well-tested. No concerns.

### 4.5 Build / CI machinery — sound, with fragility at the edges

- ✅ `verify-apk-no-gms.mjs` correctly checks for *declarative* hard GMS
  dependencies (`uses-library`/`uses-feature`) and is honest that runtime
  reference detection is out of scope — the Waydroid VANILLA launch test is the
  intended complement. `verify-apk-metadata.mjs` and `build-android-apks.mjs`
  are lean and appropriate.
- ⚠️ **MINOR (latent) — `ios.yaml` assumes `platform.ios` exists**
  (`ios.yaml:80,183,734` read `config.variant.platform.ios.bundleId`
  unconditionally). This branch made `platform.ios` optional, so the assumption
  is now unguarded. **Not a live blocker** — the iOS lane only ever builds the
  default variant, and c64u-remote is not in its matrix — but it would crash if
  anyone built the Android-only variant on the iOS lane. Add `?.` + a clear
  skip/error to make the new schema flexibility safe.
- ⚠️ **MINOR (CI hygiene/security) — `waydroid-smoke.sh:76` pipes an unpinned
  remote installer to bash** (`curl -s https://repo.waydro.id | bash`). It has a
  distro-package fallback, but an unpinned `curl | bash` in CI is a supply-chain
  smell; prefer a pinned version or the distro package directly.
- ⚠️ **MINOR — the smoke scripts (waydroid/emulator/keypad) are substantial
  shell with backgrounded processes, suppressed errors, and tight timeouts.**
  They are real, working tests, but opt-in and `continue-on-error`, so they can
  rot silently. The escape hatches are good defensive design; just budget for
  the maintenance.

### 4.6 Documentation & agentic artifacts

- ✅ **Commendable honesty.** `touch-free-and-sailfish-support.md:13-19` and the
  compatibility review repeatedly mark items as "designed for / validated
  against constraints" and clearly separate what was validated on Linux/Waydroid/
  a de-Googled Android device from what remains device-gated. This is exactly the
  right posture for a pre-release target.
- ⚠️ **MAJOR (repo hygiene) — agent-loop scratch files are committed under
  `docs/plans/`.** The 9 numbered `handover/0001..0009`, `ralph/STATE.md`, and
  related files are transient loop state. Project convention is that this lives
  under `docs/agentic/` (git-ignored except README). Move them there (or gitignore
  them); keep only durable reference docs under `docs/plans/callback8020/`.
- ⚠️ **MINOR — Sailfish AppSupport claims lack citations.** The compatibility
  review asserts facts (Android-13-based AppSupport, LXC container, no Google
  services) without linked sources. These are publicly documented by Jolla and
  general Sailfish coverage, so add a short "Sources" section with URLs + access
  dates to make the claims independently auditable.
- ⚠️ **MINOR — `keymap.md` keycode table does not repeat the "unvalidated"
  caveat.** The header hedges correctly, but the per-key table reads as
  confirmed. Add an inline marker so a scanning reader is not misled.
- ⚠️ **NIT — `PLANS.md`/`WORKLOG.md` churn is large** but append-only and
  appropriate for a multi-session effort; archive/trim before landing on `main`.

### 4.7 Tests — high quality

The input-subsystem and focus-ring tests are genuine behaviour tests, not
coverage theater (`t9.test.ts`, `focusController.test.ts`,
`focusNavigation.test.ts`, and the per-component `*.focus.test.tsx` files that
assert pruned/disabled CTAs are absent from the ring). Minor gap: the
`commodoreCallback8020` profile's non-d-pad bindings (soft keys, back, call,
menu) are under-tested — fine to defer since they are unvalidated anyway, but
worth parity tests if the profile ships.

## 5. Prioritised recommendations

**P0 — correctness**
1. Gate `useT9Input` in `SavedDeviceEditorFields` to the `c64u-remote` variant
   (or remove T9 from the MVP), so the main variant's web/iOS/Android device
   editors stop intercepting digit keys (§4.2).

**P1 — scope / risk (do before investing further)**
2. Decide T9's fate explicitly: per §3, the soft keyboard covers text entry on a
   working touchscreen at 480×640. Recommend **dropping T9 from the MVP** or
   hiding it behind an off-by-default toggle.
3. **Defer the `commodoreCallback8020` key profile** until real device key codes
   are available; keep the (cheap, additive, gated) d-pad focus ring if no-touch
   navigation is wanted, but don't ship guessed key codes (§4.3).
4. Move the `handover/`+`ralph/` scratch artifacts to `docs/agentic/` per
   convention (§4.6).

**P2 — robustness / hygiene**
5. Add `?.` + skip/clear-error in `ios.yaml` for `platform.ios` (§4.5).
6. Pin or replace the `curl | bash` Waydroid installer (§4.5).
7. Add an explicit `android_only` schema flag to consolidate enforcement (§4.1).
8. Verify no double-activation under keyboard activation of the variant (§4.3).
9. Add citations to the compatibility doc and an inline caveat to `keymap.md`
   (§4.6).

## 6. Long-term cross-platform maintainability — conclusion

The parts that age well — small-screen responsiveness, the variant/feature-flag
plumbing, the Android-only manifest stripping, and the honest documentation —
are the parts that serve **all** platforms and are validated against real
constraints. The parts that carry maintenance risk — the T9 composer and the
speculative keypad profile — are precisely the parts that (a) duplicate a
platform capability (the soft keyboard) that already exists once touch is
available, and (b) depend on hardware facts that are not yet known.

The cleanest path is therefore not "build more of the keypad stack," but
**ship the touch + soft-keyboard experience for the new variant now** (skinning,
feature pruning, responsiveness, Android-only enforcement — all of which are in
good shape), **fix the one T9 gating regression**, and **hold the keypad/T9
work as a clearly-scoped, off-by-default enhancement** to be finished against
real hardware and confirmed key codes. That keeps the cross-platform codebase
simple, avoids shipping a redundant input path, and defers the genuinely
device-dependent work until it can be done once, correctly.
