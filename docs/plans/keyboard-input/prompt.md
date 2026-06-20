# Keyboard, Keypad / T9 Input — Completion, Selected-Control Highlight, and Diagnostics

## ROLE

You are an expert Capacitor, Android WebView, React, TypeScript, Radix UI, Playwright, Maestro, accessibility, mobile input-systems, diagnostics, CI, and GitHub workflow engineer working in the C64 Commander repository (also shipped as the C64U Remote variant).

You are completing production-quality **keyboard, keypad, and T9 input** support so the app is fully operable — and testable — without a touchscreen, while remaining a touch-first app for everyone else.

The repository already has substantial input infrastructure. **You must extend what exists. Do not create parallel systems.**

---

## PRIME DIRECTIVE — NON-NEGOTIABLE INVARIANT

This is the single most important requirement. Everything else is subordinate to it.

> **The app's UX must not change in any way unless a key event is recognized AND has an effect.**
> The only new visible affordance, ever, is a clear highlight of the currently selected control (CTA, and the current value/position of a slider or dropdown) — shown **only** once a recognized navigation/activation keystroke takes effect, layered on top of (never replacing) existing focus styling, and removed the instant the user touches the screen.

Precisely, there are exactly four states:

1. **Flag `keypad_input_enabled` is OFF (default).** The rendered DOM, styling, attributes, tab order, and behavior must be **byte-for-byte equivalent to today**. No `data-key-selected`, no extra attributes, no new listeners doing anything observable, no new value labels. (The `FocusNavigationProvider` is always mounted but its keydown listener is detached when the flag is off — keep it that way.)
2. **Flag ON, but no recognized+effective key yet, and during any pointer/touch use.** Still **byte-for-byte equivalent to the flag-OFF baseline.** Registering sliders/dropdowns in the focus ring must add **no** visible affordance, no `tabindex` change, no attribute, no new chrome. Modality is `pointer`.
3. **Flag ON, and a recognized key produces an effect** (focus moved, control activated, back handled, slider value changed, dropdown opened/navigated, or a T9 composer key consumed in a field). Now — and only now — modality becomes `key-navigation` and the current focus-ring item gets the selected-control highlight (`data-key-selected="true"`).
4. **Flag ON, key modality active, then the user touches/clicks** (`pointerdown`/`touchstart`). Modality immediately returns to `pointer` and the highlight is removed the same frame.

A keystroke that is **not recognized** (no semantic action) or **recognized but ignored** (produces no effect — e.g. an arrow press with no registered items, a soft key nobody owns) must **not** flip modality, must **not** show a highlight, and must **not** call `preventDefault`. Native behavior is preserved.

Treat any deviation from the above as a release blocker, not a polish item. The Playwright and unit tests below exist primarily to prove this invariant.

---

## WHAT ALREADY EXISTS — DO NOT RE-CREATE

Read these before touching any code. The single source of truth for each fact is the code itself; verify rather than trust this summary if anything looks off.

**Normalization and key mapping** (complete — extend only if a genuine binding is missing):
- `src/lib/input/keyEvent.ts` — the `SemanticAction` union and `SEMANTIC_ACTIONS` array (the authoritative action list: `digit0`–`digit9`, `star`, `hash`, `dpadUp/Down/Left/Right`, `center`, `softLeft`, `softRight`, `back`, `delete`, `enter`, `escape`, `nextField`, `previousField`, `activate`, `openMenu`, `closeMenu`, `toggleInputMode`), plus `normalizeKeyEvent()`, `resolveSemanticAction()`, `findBinding()`, `isDigitAction()`, `digitForAction()`. `normalizeKeyEvent` returns `{ action: SemanticAction | null, key, code, repeat, modifiers, raw }`.
- `src/lib/input/keymap.ts` — `KeyBinding`, `Keymap`, `defineKeymap()`, `mergeKeymaps()` (override bindings are prepended, first-match-wins).
- `src/lib/input/profiles/defaultKeyboard.ts` — desktop/Bluetooth-keyboard profile: arrows→dpad, Space→center, Enter/NumpadEnter→enter, Tab/Shift+Tab→next/previousField, Backspace/Delete→delete, Escape→escape, Digit/Numpad0–9→digit*, `*`/NumpadMultiply→star, `#`→hash, F1/F2→softLeft/Right, F3→toggleInputMode, ContextMenu→openMenu.
- `src/lib/input/profiles/keypad.ts` — Android keypad profile (merged over defaultKeyboard): D-pad keyCodes 19–23 + `Dpad*` codes, Star/Pound keyCodes 17/18, SoftLeft/Right keyCodes 1/2, Back keyCode 4 + GoBack/BrowserBack, Call keyCode 5→activate, ContextMenu/keyCode 82→openMenu, `multiTapTimeoutMs: 1000`.
- `src/lib/input/profiles/index.ts` — `INPUT_PROFILES = { defaultKeyboard, keypad }`, `resolveInputProfile()`, `DEFAULT_INPUT_PROFILE_ID = "defaultKeyboard"`.

**T9 state machine** (complete — extend only for a missing hostname character):
- `src/lib/input/t9.ts` — pure, timer-free multi-tap + hostname composer. Hostname mode: digits insert directly; star multi-taps separators `["." , ":" , "-" , "_" , "/"]` (default `.`). `applySemanticAction()` is the single entry point. Caller supplies `now`.

**Focus management** (complete for CTAs — you will extend it to sliders and dropdowns):
- `src/lib/input/focusController.ts` — `FocusController`: ordered registry of `FocusItem` (`id`, `order`, `group?`, `disabled?`, `activate`). `focusNext/Previous` wrap; a forward step from "nothing selected" lands on the first enabled item.
- `src/lib/input/focusNavigation.ts` — `NavigationController`: wraps `FocusController` + a LIFO `DismissibleLayer` stack (`pushLayer`/`removeLayer`/`topLayer`/`layerDepth`) + a `fieldEngaged` flag; `dispatch(action) → NavigationOutcome`. **Vertical nav (`dpadDown/nextField`→next, `dpadUp/previousField`→prev), activate (`center/enter/activate`), and the `back` chain (`back/escape`: close popup → leave menu → leave field → navigateBack) are owned here. `closeMenu` dismisses the top `menu` layer. Horizontal d-pad (`dpadLeft/dpadRight`), soft keys, digits, and `openMenu` are deliberately returned as `{ type: "ignored" }` so the focused widget / T9 composer / context handlers can own them — the global controller never steals them.** Read this file carefully; the routing model below depends on it.
- `src/hooks/useFocusNavigation.tsx` — `FocusNavigationProvider` (ONE global `keydown` listener, gated by `enabled`; skips editable targets; `preventDefault` only when `dispatch(...).type !== "ignored"`; `onFocus` callback imperatively calls `element.focus()`); `useFocusItem<T>({ id, order, group?, disabled?, onActivate? }) → RefCallback<T>` (registers into the controller; the returned ref callback **only stores the element — it adds no `tabindex`/attributes/styling**; an empty `id` opts out of registration); `useFocusNavigation()` returns the `NavigationController | null`.
- `src/hooks/useT9Input.ts` — React adapter: attach the returned `onKeyDown` to an `<input>`. Intercepts only `digit*`/`star`/`hash`/`toggleInputMode` (composer keys); **every other key passes through untouched** (no `preventDefault`), so Backspace/arrows/Enter/Tab/letters keep native behavior. Respects `enabled`.

**Feature flag** (already wired — do not recreate):
- Source of truth: `src/lib/config/feature-flags.yaml`, id `keypad_input_enabled`, `enabled: false`, `group: experimental`, `visible_to_user: true`, title "Keypad / T9 input". The `*.generated.ts` registry files (`src/lib/config/featureFlagsRegistry.generated.ts`, `src/generated/variant.ts`) are **generated — never hand-edit them**. If (and only if) you must change flag metadata, edit the YAML and run `node scripts/compile-feature-flags.mjs`; `npm run lint` runs `feature-flags:check` which fails if generated files drift.
- `src/App.tsx` defines `KeypadFocusNavigation`, **always mounted**, rendering `<FocusNavigationProvider enabled={flags.keypad_input_enabled} profileId="keypad" onNavigateBack={() => navigate(-1)} >`. Note: with the flag on, an exhausted `back`/`escape` calls `navigate(-1)` (router back) — an intentional keypad behavior; document it, do not "fix" it.
- `src/components/devices/SavedDeviceEditorFields.tsx` passes `keypadInput` to `useT9Input` on the name (multitap) and host (hostname) fields. `SettingsPage.tsx` and `DiagnosticsDialog.tsx` also thread `keypadInput={flags.keypad_input_enabled}` to those fields.

**Sliders and their value display already exist** (you will add focus-ring participation + highlight, **not** new value labels):
- `src/pages/home/HomeCpuSpeedSlider.tsx` — Radix `Slider`; always-on value label `data-testid="home-cpu-speed-value"`; slider `data-testid="home-cpu-speed-slider"`.
- `src/components/config/ConfigItemRow.tsx` — a single shared component that renders one of: **checkbox**, **Radix Select** (`controlKind === "select"`; trigger has an `aria-label` but **no `data-testid` yet**), **Radix Slider** (`controlKind === "slider"`; `data-testid={sliderTestId}` + always-on value label `data-testid={valueTestId}`), or **text Input**.
- `src/components/.../VolumeControls.tsx` (search for `VolumeControls`) — Radix `Slider`; always-on value label `data-testid="volume-label"`; slider `data-testid="volume-slider"`.
- `src/hooks/useDeviceBoundSlider.ts` (search for `useDeviceBoundSlider`) — throttles writes to protect the C64U: a "throttled-latest" coalescing preview path plus a single commit path. Components feed it via the Radix `onValueChange` (preview) and `onValueCommit` (commit) callbacks; a reconciliation watchdog (~2s default) and polling pauses guard the device. **This is the path key-driven changes must reuse.**
- `src/components/ui/slider.tsx` — wraps `SliderPrimitive.Root`/`Thumb`. Radix puts `role="slider"` + `aria-valuenow/min/max` on the thumb and **handles ArrowLeft/Right/Up/Down natively** (firing `onValueChange`/`onValueCommit`). The primitive also has a drag-only value popup `data-testid="slider-value-display"` (shown via `showValueOnDrag`).
- `src/components/ui/select.tsx` — wraps Radix `Select`; the trigger renders `role="combobox"` with Radix-managed `aria-expanded`, and Radix handles open/typeahead/Arrow/Enter/Escape natively once focused/open.

**Diagnostics** (existing infrastructure — emit into it, do not duplicate):
- `src/lib/logging.ts` — `addLog(level, message, details?)`, levels `debug|info|warn|error`. **`addLog` already self-gates**: it drops non-error logs when `shouldSuppressDiagnosticsSideEffects()` is true, and drops `debug` logs when `loadDebugLoggingEnabled()` is false. Max 500 entries; fires `c64u-logs-updated`.
- `src/lib/appSettings.ts` — `loadDebugLoggingEnabled()` reads localStorage `c64u_debug_logging_enabled` (default false).
- `src/lib/diagnostics/diagnosticsOverlayState.ts` — `shouldSuppressDiagnosticsSideEffects()` is true while the diagnostics overlay is active or in a short post-close window (keeps coverage/parallel-E2E runs noise-free).
- `src/lib/diagnostics/diagnosticsExport.ts` — export tabs `error-logs | logs | traces | actions`; test handle `window.__c64uLastDiagnosticsExport`.
- `src/lib/diagnostics/exportRedaction.ts` — `redactExportValue()`/`redactExportText()` **recurse through nested objects/arrays at any depth** and redact by key name: `HOST_KEY_REGEX = /(host|hostname|ip|address)/i`, `SENSITIVE_KEY_REGEX = /(password|token|authorization|auth|secret|credential|api[-_]?key)/i`, `LOCATION_KEY_REGEX = /(url|path|uri)/i` (string values). Structure your `details` so sensitive values sit under keys matching these patterns; do not write a second redactor.

**Existing tests** (extend, do not replace):
- Lib: `tests/unit/lib/input/keyEvent.test.ts`, `t9.test.ts`, `keymap.test.ts`, `focusController.test.ts`, `focusNavigation.test.ts`.
- **Hooks (do not overlook these — your new modality/highlight/diagnostics logic lives in the hooks): `tests/unit/hooks/useFocusNavigation.test.tsx`, `tests/unit/hooks/useT9Input.test.tsx`.**
- Playwright precedent: `playwright/buttonHighlightProof.spec.ts` (highlight assertions), `playwright/settingsConnection.spec.ts` (`getByTestId` + host field), plus specs that seed flags via `page.addInitScript`.

---

## INPUT ROUTING MODEL & KNOWN HAZARDS (read before implementing GAPs 1–3)

The current model: the global controller owns **vertical** focus traversal, **activate**, and the **back** chain; it returns `ignored` for **horizontal** d-pad, soft keys, and digits so the *focused widget* can own them; and the provider only calls `preventDefault` when an action was consumed. This is exactly what guarantees the Prime Directive — preserve it.

Three concrete hazards arise when sliders and dropdowns join the ring. Your design must resolve each, and each must have a test.

- **HAZARD 1 — Slider arrow double-handling.** A focused Radix slider thumb already adjusts its value on *all* arrow keys natively. But the global listener also dispatches those keys: `ArrowLeft/Right → dpadLeft/Right → ignored` (harmless), while **`ArrowDown/Up → dpadDown/Up → focusNext/Previous` moves focus**. So a naive integration makes `ArrowDown` on a slider *both* nudge the value *and* jump focus. Required contract for an engaged/focused slider: **Left/Right change the value only (no focus move); Up/Down move focus only (no value change); the value change must route through `onValueChange`/`onValueCommit` so `useDeviceBoundSlider`'s throttle/watchdog still applies.** You decide the mechanism (e.g. intercept Up/Down at the slider to stop Radix's value change while letting focus move; or render so the focused element drives `onValueChange` for Left/Right and the controller owns Up/Down) — but it must be coherent, documented, and proven by the tests in GAP 2.

- **HAZARD 2 — Open dropdown vs. global nav.** Radix Select content is *not* an editable target, so while it is open the global window listener still fires. Up/Down would then move the *underlying page* focus ring instead of the dropdown's options. Required: **while any dismissible layer (open Select/dialog) is on the stack, the global handler must not run vertical nav / activate against the underlying ring** — the open layer (Radix) owns Up/Down/Enter/typeahead. Only the `back` chain stays global, so keypad `back` (keyCode 4, which Radix does not recognize) can close it. To let the layer close the Select programmatically, make the Select **controlled** (`open`/`onOpenChange`) so the layer's `dismiss` can set `open=false`. Prove with the GAP 3 test: with a dropdown open, `ArrowDown` moves the option highlight, not the page focus ring.

- **HAZARD 3 — No re-render storms (coverage hang).** This project has a known failure mode where setState-in-effect with referentially-unstable-but-equal deps spins an infinite re-render loop that hangs `npm run test:coverage` with a CPU-pegged worker. Implement modality tracking and the highlight **imperatively** — a `ref` for modality plus direct DOM attribute toggling on the focused element, mirroring how the provider already imperatively calls `element.focus()`. If you must surface modality as React state for a consumer, bail on value-equality before `setState`. Do not introduce an effect whose dependency identity changes every render.

---

## GENUINE GAPS TO IMPLEMENT

Confirmed missing by repository inspection. Implement these; do not re-implement anything in "WHAT ALREADY EXISTS."

### GAP 1 — Input-modality tracking and the selected-control highlight

No modality tracking exists; no `data-key-selected`; no persistent selected-control styling. (Note: the app's existing focus treatment is NOT browser-default — buttons use a 160 ms `focus-flash` box-shadow that *fades to nothing*, and form controls use `focus-visible:ring-*`. A brief flash is unusable as a steady "where am I" indicator for key navigation, which is exactly why a persistent highlight is needed.)

Implement, centrally (prefer `FocusNavigationProvider`/`useFocusItem` over per-component code):
- **Modality**, tracked imperatively (per HAZARD 3): becomes `key-navigation` only when a dispatch produces a *non-`ignored`* outcome (focus moved / activated / back handled / layer dismissed / field disengaged / slider value adjusted via the focused widget), or when `useT9Input` consumes a composer key in a field. Becomes `pointer` on `pointerdown`/`touchstart` (use capture-phase window listeners so it always wins). Never flips on unrecognized or ignored keys.
- **Highlight contract:** set the attribute **`data-key-selected="true"`** on the DOM element of the current `FocusController` item, and only there, **iff `keypad_input_enabled` is true AND modality is `key-navigation`.** Standardize on this exact attribute (CSS and tests both target `[data-key-selected="true"]`). The attribute must be **absent** (not `="false"`) whenever the flag is off or modality is `pointer`, and must move to the new element on every focus change and clear from the old one.
- **Styling:** add one clearly visible, **persistent** selection indicator (e.g. a steady ring/background using the existing `--ring` token), layered on top of — never replacing or suppressing — the existing `:focus-visible`/`focus-flash`/ARIA. It must read as obviously "selected," distinct from the transient flash, and meet contrast on the app's surfaces.
- Touch/pointer interaction clears the highlight the same frame. Read the flag from the single existing source — do not add a second settings check.

### GAP 2 — Sliders join the focus ring (HomeCpuSpeed, ConfigItemRow slider, VolumeControls)

These three are not registered with `useFocusItem` and have no key support.

Implement:
- Register each slider with `useFocusItem` following the existing CTA pattern (register unconditionally; the provider's `enabled` gate keeps it inert when the flag is off — do **not** add `tabindex` or any visible affordance at registration; honor the Prime Directive state 2).
- When focused in key modality, resolve **HAZARD 1**: `dpadLeft/dpadRight` (and their `ArrowLeft/Right` aliases) adjust the value through the component's existing `onValueChange`/`onValueCommit` → `useDeviceBoundSlider`; `dpadUp/dpadDown` move focus away (`focusNext`/`focusPrevious`) without changing the value.
- **Reuse the existing always-on value label** (`home-cpu-speed-value`, `valueTestId`, `volume-label`) — do not add new always-on chrome. For the key-selected affordance you may surface the current value/thumb more prominently *only* while `data-key-selected` is set (e.g. reuse the primitive's `slider-value-display` popup during key adjustment). Confirm Radix already exposes `aria-valuenow`/`aria-valuemin/max`; add `aria-valuetext` where a human-readable value (e.g. a formatted CPU speed) is clearer than the raw number.
- **Hardware safety:** key-driven changes must go through the same throttled setter as touch drags — no separate key-repeat path that bypasses the watchdog/coalescing. Prove with a unit test that repeated `dpadLeft` within the throttle window yields exactly one device write, not N. Do not weaken the throttle to make a test pass.
- Touch-dragging a slider must never leave `data-key-selected` visible (modality returns to `pointer` on `pointerdown`).

### GAP 3 — Dropdowns join the focus ring (Radix `Select` in `ConfigItemRow` and elsewhere)

The Radix `Select` is unreachable by key navigation. Fix at the shared `ConfigItemRow` level, not per instance. **Lean on Radix's native keyboard support — do not build a parallel option-navigation engine** (that would risk regressions).

Implement:
- Add a stable `data-testid` to the `SelectTrigger` and register it with `useFocusItem`.
- `center`/`enter`/`activate` opens the dropdown (the focus item's `activate` clicking the trigger is sufficient; Radix then moves focus into the list).
- Resolve **HAZARD 2**: make the Select controlled, push a `DismissibleLayer` on open and pop on close, and ensure the global handler does not run vertical nav/activate against the underlying ring while the layer is open — let Radix own `dpadUp/dpadDown` (option navigation, keep the highlighted option visible when scrolling), `enter`/`center` (confirm), and `escape` (close). Keypad `back` (keyCode 4) must close it via the layer's `dismiss`.
- Verify ARIA is correct via Radix (`aria-expanded` on the trigger; `aria-selected` on the active option; `aria-activedescendant` where Radix provides it). Do not duplicate ARIA Radix already manages.
- Touch-opening or touch-selecting must never leave `data-key-selected` visible.
- The `ConfigItemRow` **checkbox** and any switch/toggle controls live in the same shared component; if including them in the ring is low-risk, do so for completeness (same register-+-activate pattern). If it adds meaningful risk, note it as a documented follow-up rather than forcing it.

### GAP 4 — Key-event diagnostics

No key events flow through `addLog()`. Add **debug-level** emission so a maintainer can calibrate real-device mappings from an export — without noise or privacy leaks.

Scope (this matters — do not log every keystroke):
- In `FocusNavigationProvider`'s global handler: emit for **recognized navigation/activation/back keys** (mapping-critical; log them verbatim) and for **unmapped keys** (`action === null`: log all raw fields with `handled: false` and an `ignoredReason` so bindings can be added from an export). The global handler already skips editable targets, so it never sees typed text.
- In `useT9Input`: emit **only for composer-consumed keys** (`digit*`/`star`/`hash`/`toggleInputMode`). Do **not** log passthrough typing (letters, Backspace, arrows) — it is noisy and risks capturing text. **Never log the field value or any free text.**
- Correctness gating is already enforced inside `addLog` (debug + suppression). For performance, cheaply check `loadDebugLoggingEnabled()` (and skip if `shouldSuppressDiagnosticsSideEffects()`) **before** building the `details` object, so the hot keydown path allocates nothing when debug logging is off.
- Emit via `addLog('debug', 'key-input', details)`. Each `details` includes, where available:
  - `category: "key-input"`, `timestamp` (ms), `route` (current app route)
  - `activeElement`: `{ tagName, role, ariaLabel, dataTestId, inputType }`
  - `selectedControlId` (current `FocusController` item id, if any)
  - `rawEvent`: `{ type, key, code, keyCode, which, location, repeat, isComposing, altKey, ctrlKey, metaKey, shiftKey }`
  - `normalizedAction` (the `SemanticAction` string, or `null`)
  - `keyFamily`: `"digit" | "numpad-digit" | "dpad" | "enter" | "delete" | "star" | "hash" | "modifier" | "unknown"`
  - `handled` (boolean), `ignoredReason` (string when not handled: e.g. `"setting-disabled"`, `"pointer-modality"`, `"no-binding"`, `"editable-target-passthrough"`, `"ignored-by-controller"`), `preventDefaultApplied` (boolean)
  - `t9State` when T9 is active: `{ active, mode, pendingLength, candidateIndex, candidateCount, committedLength }` — **lengths/indices only, no raw text**
  - `keypadEnabled` (flag value), `modality` (`"key-navigation" | "pointer"`)
- Privacy: structure `details` so the recursive key-based redactor sanitizes anything sensitive — keep host/IP-bearing values (if any) under keys matching `host|hostname|ip|address`. Digit/star/hash/navigation/control keys are mapping-critical and may be logged verbatim. If any field could embed user-entered text (e.g. an `ariaLabel` around a device field), prefer omitting it over leaking it.

### GAP 5 — Playwright tests

No Playwright test exercises `keypad_input_enabled` or key navigation. Add `playwright/keypadInput.spec.ts` (do **not** tag it `@screenshots` or `@web-platform`, so `npm run test:e2e` runs it). Seed flags with `page.addInitScript()` using the real key format **`localStorage.setItem("c64u_feature_flag:keypad_input_enabled", "1")`** (string `"1"`); follow `buttonHighlightProof.spec.ts`/`settingsConnection.spec.ts` for `getByTestId` and init-script patterns. Use `page.keyboard.press()`; assert both ARIA (`aria-expanded`, `aria-selected`, `aria-valuenow`) and visible state; no arbitrary sleeps — use `waitFor`/attribute assertions.

Cover:
- **Prime Directive (state 1):** flag OFF → pressing Arrow/Tab/Enter shows no `data-key-selected` and changes nothing.
- **Prime Directive (state 2):** flag ON but before any key, and during pointer interaction → still no `data-key-selected` and no extra interactive affordances vs. baseline (assert the highlight/attribute is absent until the first recognized key, and after a `mouse`/tap it is absent again).
- **State 3:** flag ON → a recognized nav key shows `data-key-selected` on the focused element; a primary CTA is reachable by Arrow/Tab and activates with Enter.
- **State 4:** pointer interaction clears `data-key-selected`.
- **HAZARD 1:** a focused slider — `ArrowLeft/Right` changes the value (visible label + `aria-valuenow`) and does **not** move focus; `ArrowDown/Up` moves focus and does **not** change the value.
- **HAZARD 2:** a `ConfigItemRow` dropdown opens with Enter; with it open, `ArrowDown` moves the option highlight (not the underlying page focus); Enter confirms; Escape closes without changing selection.
- **T9:** the host field in `SavedDeviceEditorFields` accepts hostname-mode input (digits insert; star cycles separators).
- **Diagnostics:** debug logging OFF → no key-input entries reach `addLog`; ON → key-input entries appear (assert via the logs/export handle).
- Touch/mouse behavior for CTAs, dropdowns, text fields, and sliders is not regressed; no unexpected console errors.

### GAP 6 — On-device key-injection verification (extend, don't duplicate)

**An ADB keypad smoke script already exists: `scripts/android-keypad-smoke.sh`** (installs, launches, drives d-pad/number/star keyevents, checks a focused node + logcat, screenshots). **Extend it — do not create `scripts/adb-keypad-smoke.sh` or any duplicate.** Add the missing keyevents and an assertion tied to this feature:
- Existing: 20 (DPAD_DOWN), 22 (DPAD_RIGHT), 23 (DPAD_CENTER), 8/16/10 (digits 1/9/3), 17 (STAR).
- Add: 19 (DPAD_UP), 21 (DPAD_LEFT), 66 (ENTER), 67 (DEL), 18 (POUND), 9 (KEYCODE_2 — T9 digit).
- Note the limitation: the script drives OS-level keys but cannot easily flip the localStorage flag; capture a screenshot/`uiautomator dump` showing a focused/selected element after navigation so the result is reviewable.

Add a Maestro flow `.maestro/keypad-input-smoke.yaml`:
1. Launch the app (reuse `subflows/launch-and-wait.yaml`).
2. Enable the flag via the existing settings pattern: `tapOn: { id: feature-flag-keypad_input_enabled, checked: false, optional: true }` (testid is `feature-flag-<id>`).
3. Return Home; drive navigation. Maestro `pressKey` cannot inject D-pad/Star — use the bash+adb harness (the extended `android-keypad-smoke.sh`, or adb `input keyevent` around the flow as `run-maestro-gating.sh` does) for key injection; use Maestro for app-level steps, screenshot/text assertions of a visible change, and a `tapOn` to prove touch clears the highlight.
4. Tag it `device` (and a `keypad` tag), **not** `ci-critical` — keypad needs special injection and would bloat the ≤6-min CI Maestro budget. State clearly that CI does **not** gate this flow; **Playwright (GAP 5) is the CI-enforced proof.** Document the Maestro version assumption and the adb fallback.

---

## MANDATORY EXECUTION RULES

1. **Plan and worklog live in the feature directory, NOT the repo root.** Create/maintain `docs/plans/keyboard-input/PLAN.md` (phases, tasks, acceptance criteria, verification commands, compatibility matrix) and `docs/plans/keyboard-input/WORKLOG.md` (decisions, files changed, commands + results, commits, push, PR URL, CI results, PR comments, mergeability; include one representative sanitized `key-input` event showing raw + normalized fields). **Do not touch the root `PLANS.md`/`WORKLOG.md` — they belong to unrelated tasks and must not be clobbered.** Begin implementation immediately after writing the plan.
2. **Do not ask for clarification.** Inspect the repo and make conservative, reversible decisions; prefer existing conventions.
3. **Keep scope strict.** Do not redesign unrelated UI. Do not rewrite the normalization layer, T9 engine, `FocusController`, or `NavigationController` unless inspection reveals a concrete defect blocking a GAP — and if it does, justify it in the worklog.
4. **Do not hide problems.** No suppressed warnings, no skipped tests, no weakened throttles. Fix root causes.
5. **Verification is deterministic and behavioral.** A log entry alone never proves a key works. For each supported key family prove both normalization and at least one visible app effect, via automated tests or a documented executable command.
6. **Honor the Prime Directive at every step.** If any change makes the app look or behave differently with the flag off, or with the flag on before a recognized key / during touch, it is wrong — revert and rethink.
7. **Commit & PR discipline.** Continue on the existing `feat/keyboard-input` branch. Coherent commits; no unrelated changes; no secrets, local paths, or diagnostics exports. Push; open a PR against `main`; **do not merge.**
8. **Termination** is allowed only when every Acceptance Criterion holds. If verification fails, fix and rerun. If CI fails, read logs and fix the root cause. Some CI is known to be intermittently flaky (iOS Maestro timing; coverage-vs-parallel-E2E artifacts) — re-run once to classify a failure as flaky vs. real before "fixing" it; never paper over a real regression as flake. Resolve PR review comments that are present at evaluation time (automated review + any human comments already posted); do not block termination indefinitely waiting for new human review.

---

## VERIFICATION COMMANDS

Run exactly these (names from `package.json`) and record exact output + pass/fail in the worklog:

```bash
npm run format:check:ts     # prettier --check
npx tsc --noEmit            # type check
npm run lint                # composite: format:check:ts + eslint + display-profiles + bundle-budgets + stale-names + variant:check + feature-flags:check
npm test                    # vitest run
npm run test:coverage       # confirm no coverage regression / no hang (watch for the HAZARD 3 loop)
npm run test:e2e            # Playwright, excludes @screenshots|@web-platform
npm run build               # production build
npm run maestro:gating      # requires an attached Android device/emulator
```

If no Android device/emulator is attached: document that clearly, run all non-device checks, ensure the extended `scripts/android-keypad-smoke.sh` is committed and executable, and treat the Maestro flow as best-effort — its absence from a device run must not block termination, but the omission must be stated explicitly.

---

## ACCEPTANCE CRITERIA

Complete only when ALL hold:

1. `docs/plans/keyboard-input/PLAN.md` and `.../WORKLOG.md` exist and reflect the implemented work; the root `PLANS.md`/`WORKLOG.md` are untouched.
2. **Prime Directive proven:** with the flag off, and with the flag on before any recognized key / during touch, the app is visually and behaviorally equivalent to baseline (no `data-key-selected`, no extra attributes/chrome/tabindex). Covered by GAP 5 states 1–2.
3. The `src/lib/input/` normalization layer, T9 engine, `FocusController`, and `NavigationController` are unchanged except for targeted, justified extensions.
4. `useFocusItem`/`FocusNavigationProvider` extended so sliders and dropdowns participate in the focus ring, with no visible affordance added at registration time.
5. `data-key-selected="true"` appears on exactly the current focus-ring item iff `keypad_input_enabled` is true AND modality is `key-navigation`; it is absent otherwise and clears immediately on pointer interaction.
6. Modality and highlight are implemented imperatively (no re-render loop); `npm run test:coverage` completes without hanging.
7. HomeCpuSpeedSlider and at least one other slider are reachable by key nav; **Left/Right adjust the value (visible label + `aria-valuenow`) without moving focus; Up/Down move focus without changing the value** (HAZARD 1 resolved).
8. Slider key adjustments reuse the existing `useDeviceBoundSlider` throttle; a unit test proves repeated `dpadLeft` within the window = one write.
9. A `ConfigItemRow` dropdown is reachable, opens via key, navigates options via key without disturbing the underlying ring (HAZARD 2 resolved), confirms, and closes (incl. keypad `back`) — all without touch.
10. The host field in `SavedDeviceEditorFields` still accepts hostname-mode T9 input — verified in Playwright.
11. Key events emit via `addLog('debug', ...)` only when debug logging is on and suppression is off; the hot path allocates nothing when off.
12. Each key-input log carries the raw + normalized fields from GAP 4; unknown keys produce an entry with all raw fields and an `ignoredReason`.
13. Exported diagnostics never include raw hostname/IP/text-field values (verified against the recursive redactor).
14. All existing `tests/unit/lib/input/` and `tests/unit/hooks/` tests still pass; new unit tests cover modality flipping (recognized+effective only), `data-key-selected` gating, diagnostics emission gating (debug off → no emit), slider throttle integration, and dropdown/layer navigation gating.
15. Playwright covers every item in GAP 5; Maestro flow or the extended ADB script covers GAP 6 (with the device caveat documented).
16. `npm run format:check:ts`, `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run test:e2e`, and `npm run build` all pass; `npm run test:coverage` shows no regression.
17. No new unexpected console warnings/errors.
18. Documentation updated (see below).
19. `feat/keyboard-input` is committed and pushed; a PR is open against `main`; all required PR checks are green (`gh pr checks`); review comments present at evaluation time are resolved; GitHub reports the PR mergeable; the PR is NOT merged.

---

## DOCUMENTATION

Add/update docs in the right existing home (check `docs/` conventions — `docs/index.md`, `docs/features-by-page.md`, `docs/ux-guidelines.md`, `docs/developer.md`, `docs/diagnostics/`; a focused `docs/keyboard-input.md` linked from `docs/index.md` is appropriate). Cover:
1. Enabling Keypad / T9 input (Settings → Experimental → "Keypad / T9 input").
2. What `data-key-selected` means and exactly when it appears (the Prime Directive states).
3. Supported key families and their normalized actions (point to `SEMANTIC_ACTIONS` as the source of truth).
4. Key-only operation guide: CTAs, sliders (Left/Right vs Up/Down), dropdowns, text fields (T9 multitap + hostname modes), and the `back`/`navigate(-1)` behavior.
5. How debug logging enables key-event diagnostics and what the export contains.
6. Privacy: what diagnostics intentionally do not record (no field text, no raw host/IP).
7. Bluetooth-keyboard test procedure; ADB keyevent test procedure (reference `scripts/android-keypad-smoke.sh` with the exact keycodes).
8. Known limitations: Bluetooth keyboard ≠ flip-phone keypad; no real flip-phone certification without real hardware; keypad Maestro flow is local/device-only and not CI-gated.

---

## ANTI-SHORTCUT CHECKS (any true ⇒ NOT done)

- Anything changes visually/behaviorally with the flag off, or with the flag on before a recognized key / during pure touch use (Prime Directive violated).
- `data-key-selected` is never set, or appears when the flag is off / after a touch.
- A new always-on value label or affordance was added (the slider labels already exist — reuse them).
- A focused slider's Up/Down changes its value, or Left/Right moves focus (HAZARD 1 unresolved).
- An open dropdown's Up/Down moves the underlying page focus ring (HAZARD 2 unresolved).
- Modality/highlight implemented with setState-in-effect that risks the coverage hang (HAZARD 3).
- Sliders/dropdowns still require touch when the flag is on.
- Slider key-repeat bypasses the write throttle.
- Diagnostics duplicate the export/redaction system, or log field text / raw host/IP, or log every keystroke.
- Unknown keys are silently dropped (no log entry).
- A duplicate `adb-keypad-smoke.sh` was created instead of extending `android-keypad-smoke.sh`; or the root `PLANS.md`/`WORKLOG.md` were overwritten.
- Playwright tests only assert "no crash," not visible/ARIA state changes.
- A real flip-phone compatibility claim is made without real-device evidence.
- Local checks pass but the branch is not pushed, the PR checks are failing/pending, or comments are unresolved.
- Success is claimed without actual command output or GitHub state proving it.

---

## IMPLEMENTATION PRIORITY ORDER

1. Preserve existing normalization, T9, `FocusController`, `NavigationController`.
2. Modality tracking + `data-key-selected` gating in the provider/`useFocusItem` (imperative; Prime Directive first).
3. Sliders into the ring with HAZARD-1-safe, throttle-safe key adjustment.
4. Dropdowns into the ring with HAZARD-2-safe layer/Radix integration.
5. Key-event diagnostics into `addLog()`.
6. Unit tests (hooks + lib), then Playwright, then Maestro/ADB.
7. Documentation.
8. Commit, push, PR, green CI, resolve comments, verify mergeability — do not merge.

---

## FINAL RESPONSE REQUIREMENT

When complete, give a concise report: (1) what changed; (2) files changed; (3) supported key families + any profile changes; (4) modality + `data-key-selected` behavior across the four Prime-Directive states; (5) how HAZARDS 1–3 were resolved; (6) user-visible feedback for CTAs, sliders, dropdowns, T9; (7) diagnostics behavior + one sanitized `key-input` event; (8) tests added/extended; (9) exact local commands run + results; (10) Android/Maestro/ADB verification performed or the exact external limitation; (11) docs updated; (12) commit SHA, branch, PR URL, CI status, comment status, mergeability; (13) known limitations / follow-ups needing real hardware. Then stop.
