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

### Local gate results (exact)
- `npx tsc --noEmit` → PASS.
- `npm run format:check:ts` → PASS (3 files auto-formatted: keypadInput.spec.ts, useFocusNavigation.tsx, keyInputDiagnostics.ts).
- `npm run lint` → PASS (eslint + display-profiles + bundle-budgets + stale-names + variant:check + feature-flags:check).
- `npm test` → **612 files / 7051 tests PASS**.
- `npm run test:coverage` → **EXIT=0, no hang** (HAZARD 3 ruled out; the "HVSC perf budgets FAILED" strings are perf-budget formatter test fixtures, not failures — all files pass).
- `npm run build` → PASS.
- `npm run test:e2e -- --grep keypadInput` → **8/8 PASS**.

### Commit / branch / PR
- Branch `feat/keyboard-input`, commit `c6396645`, pushed to origin.
- PR: https://github.com/chrisgleissner/c64commander/pull/290 (base `main`). NOT merged.
- `prompt.md` deliberately not committed (only PLAN.md + WORKLOG.md in the feature dir).

### CI (PR #290, run 27855661317)
First run: every check PASS or skipping EXCEPT `Web | E2E (sharded) (12, 12)` which FAILED on the
pre-existing timing-flaky `launchSequence.spec.ts:255` ("shows the launch sequence … reaches
app-ready") — failed all 3 attempts with VARIED modes (title-not-visible, then two
`waitForFunction` 20s timeouts). Classified as flake, NOT a regression:
- That test touches no keyboard/focus/slider/dropdown/diagnostics code (grep confirms).
- The keypad feature is OFF by default in that test, so the provider's key/pointer listeners
  are detached and add no startup cost.
- `main` itself shows intermittent CI failures (timing-sensitive suite), and all 11 other E2E
  shards + iOS Maestro + Android Maestro gating + Screenshots passed.
Action: re-ran the failed shard. Re-run #1 failed again (same flaky test) — so I proved it
LOCALLY: `playwright test launchSequence -g "reaches app-ready"` → **PASS in 8.2s** with my
changes. Combined with main passing it and the test referencing no keypad code, this is a
loaded-runner timing flake, not a regression. Re-run #2 of the shard → **PASS**, clearing it.
Final state: 30 checks pass, 3 skipping (release/GHCR/merge-on-failure), 0 fail; PR
`MERGEABLE`. The PR is NOT merged.

Notable green checks confirming no regression from shared-component changes: `Android | Tests +
Coverage`, all `Web | E2E (sharded)` 1–11, `Web | Screenshots`, `Web | Build + tests`
(amd64+arm64), `Web | Unit tests (coverage)`, `iOS | Maestro`, `Android | Maestro gating`
(my keypad Maestro flow is correctly NOT ci-critical). No automated review bot; only an
informational `codecov` comment (nothing to resolve); no human reviews at evaluation time.
