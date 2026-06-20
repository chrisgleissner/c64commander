# Keyboard / Keypad / T9 Input — Worklog

## Context (start of session)

- Branch `feat/keyboard-input` is even with `main` @ `d5127444`. All "WHAT ALREADY
  EXISTS" infrastructure (`src/lib/input/*`, `useFocusNavigation.tsx`, `useT9Input.ts`,
  the `keypad_input_enabled` flag, `App.tsx` `KeypadFocusNavigation`) is present and
  unchanged. GAPs 1–6 confirmed undone by inspection: no `data-key-selected`, no
  `key-input` diagnostics, no `playwright/keypadInput.spec.ts`, `useFocusItem` only on
  CTAs (not sliders/dropdowns).
- Flag seed format confirmed: `localStorage["c64u_feature_flag:keypad_input_enabled"]="1"`
  (read by `src/lib/native/featureFlags.web.ts`).
- Radix slider (`@radix-ui/react-slider@1.4.1`): keydown on the **Root**, composed
  `composeEventHandlers(props.onKeyDown, internal, {checkForDefaultPrevented:true})` — an
  `onKeyDown` we pass that `preventDefault()`s suppresses Radix's value step. Thumb already
  has `tabIndex=0` (no new affordance from focusing it). Confirmed in node_modules.
- Radix select trigger = `role=combobox`, Radix-managed `aria-expanded`; native
  arrow/typeahead/Enter/Escape once open. Existing `usePopoverBackDismissRoot` already
  wires Android-Back→Escape for poppers (separate from the NavigationController layer).

## Key design decisions

- Modality + highlight implemented imperatively (module ref + DOM attribute toggle) to
  avoid the project's known coverage re-render hang ([[react-effect-setstate-coverage-hang]]).
- `aria-valuetext` deliberately **not** added: it is an attribute and would violate Prime
  Directive states 1–2 (must be byte-for-byte baseline before key-nav). `aria-valuenow`
  (Radix, always present) + the existing always-on value label satisfy criterion 7.
- Global handler does **not** log editable-target passthrough — it would risk capturing
  typed text; matches GAP 4 ("the global handler already skips editable targets, so it
  never sees typed text"). Unknown keys on non-editable targets ARE logged.
- T9-in-field flips modality to `key-navigation` per the Prime Directive; the highlight
  follows `FocusController.current()` (criterion 5, literal). Documented in docs.

## Progress log

### Implementation (GAPs 1–7)

Files changed:
- New: `src/lib/input/inputModality.ts` (imperative modality singleton + subscribe + value-equality bail).
- New: `src/lib/diagnostics/keyInputDiagnostics.ts` (`resolveKeyFamily`, `buildKeyInputDetails`, cheap-gated `emitKeyInputDiagnostics`).
- `src/lib/input/index.ts` — export inputModality + `pendingCandidateCount`.
- `src/lib/input/focusNavigation.ts` — HAZARD 2 layer guard: vertical-nav/activate → `ignored` while any layer open; back chain stays global.
- `src/lib/input/t9.ts` — additive `pendingCandidateCount` helper (no behavior change).
- `src/hooks/useFocusNavigation.tsx` — modality ref + imperative `refreshHighlight` (`data-key-selected`), capture-phase pointer listeners, key-input diagnostics, context exposes `enabled`+`keymap`, `useFocusNavigationContext`, `useDismissibleNavigationLayer`; back/escape bail on `defaultPrevented` (Radix popup already dismissed) — scoped so slider Up/Down (dpad) still moves focus.
- `src/hooks/useT9Input.ts` — flips modality + emits lengths-only T9 diagnostics on composer-consumed keys.
- `src/components/ui/slider.tsx` — keypad props; thumb registered in ring; Up/Down `preventDefault` (suppress Radix step, global moves focus), Left/Right own value via existing `handleValueChange` + debounced single `handleValueCommit` (`SLIDER_KEY_COMMIT_DEBOUNCE_MS`); inert at baseline.
- `src/pages/home/components/HomeCpuSpeedSlider.tsx`, `src/pages/playFiles/components/VolumeControls.tsx`, `src/components/ConfigItemRow.tsx` (slider + select: controlled open, layer push, derived `data-testid`, trigger registration, `onActivate` opens).
- `src/index.css` — `[data-key-selected="true"]` persistent ring (does not replace focus-flash/focus-visible).
- `tests/setup.ts` — `resetInputModality()` in `afterEach`.
- Tests: new `inputModality.test.ts`, `keyInputDiagnostics.test.ts`, `slider.keypad.test.tsx`, `playwright/keypadInput.spec.ts`; extended `focusNavigation.test.ts`, `useFocusNavigation.test.tsx`, `useT9Input.test.tsx`.
- Device: extended `scripts/android-keypad-smoke.sh` (added keyevents 19/21/66/67/18/9 + uiautomator dump/pull); new `.maestro/keypad-input-smoke.yaml` (tags `device`,`keypad`).
- Docs: new `docs/keyboard-input.md` + link from `docs/index.md`.

### Decisions while implementing
- HAZARD 1 mechanism: thumb is the registered ring element (already `tabIndex=0`); `onKeyDown` on the Slider Root composes with Radix (`checkForDefaultPrevented=true`), so `preventDefault` on Up/Down suppresses Radix's value step while the global window handler still moves focus.
- Key-repeat coalescing: each Left/Right press calls `handleValueChange` (draft + label + `aria-valuenow`), commit is debounced to one `handleValueCommit` per burst → one device write; flushed on Up/Down (leaving) and pointerdown.
- HAZARD 2 dropdown: fixed at `ConfigItemRow` level (controlled `open`, `useDismissibleNavigationLayer` pushes a `popup` layer); the layer guard suppresses the underlying ring; keypad `back` (keyCode 4) closes via the layer; Escape is owned by Radix (global back chain bails on `defaultPrevented` to avoid an extra `navigate(-1)`).
- Playwright: reach `/config` via client-side nav (a direct deep `goto("/config")` after the SW registered in earlier tests can render blank); reach controls via the focus ring (`ringFocus`).

### Verification commands + results
- `npx tsc --noEmit` → PASS (no output).
- `npm run format:check:ts` → PASS (after `prettier --write` on 3 files).
- `npm run lint` → PASS (format + eslint + display-profiles + bundle-budgets + stale-names + variant:check + feature-flags:check all green).
- `npm run build` → PASS (built in ~8s, postbuild notices packaged).
- `npm run test:e2e -- --grep keypadInput` (PLAYWRIGHT_SKIP_BUILD=1) → 8/8 PASS (Prime Directive states 1–4, HAZARD 1, HAZARD 2 incl. keypad-back close, T9 host, diagnostics on/off).
- Targeted unit tests (input lib + hooks + slider keypad + diagnostics) → 113/113 PASS.
- `npm test` (full) → see below.

### One sanitized `key-input` event (debug on; recognized nav key)
```json
{
  "category": "key-input",
  "route": "/",
  "activeElement": { "tagName": "BUTTON", "role": null, "ariaLabel": "Config", "dataTestId": "tab-config", "inputType": null },
  "selectedControlId": "tab-config",
  "rawEvent": { "type": "keydown", "key": "ArrowDown", "code": "ArrowDown", "keyCode": 40, "which": 40, "location": 0, "repeat": false, "isComposing": false, "altKey": false, "ctrlKey": false, "metaKey": false, "shiftKey": false },
  "normalizedAction": "dpadDown",
  "keyFamily": "dpad",
  "handled": true,
  "preventDefaultApplied": true,
  "keypadEnabled": true,
  "modality": "key-navigation"
}
```
A T9 entry adds `t9State: { active, mode, pendingLength, candidateIndex, candidateCount, committedLength }` (counts only — never the host/field text).
