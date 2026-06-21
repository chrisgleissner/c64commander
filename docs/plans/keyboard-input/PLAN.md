# Keyboard / Keypad / T9 Input — Completion Plan

Branch: `feat/keyboard-input` (cut from `main` @ d5127444; the input infrastructure
described in the prompt's "WHAT ALREADY EXISTS" is all present and unchanged).

This plan implements GAPs 1–6: the selected-control highlight + modality tracking,
sliders and dropdowns joining the focus ring, key-event diagnostics, and the test +
device verification harness. The pure `@/lib/input` layer (keyEvent, keymap, profiles,
t9, focusController) and `useT9Input` composer logic are **reused, not rewritten**;
`NavigationController` gets one targeted, justified extension (HAZARD 2 layer guard).

## PRIME DIRECTIVE (the invariant everything is subordinate to)

Four states; `data-key-selected="true"` appears **iff `keypad_input_enabled` AND
modality is `key-navigation`**, on exactly the current `FocusController` item:

1. Flag OFF → DOM byte-for-byte equal to today (provider keydown detached).
2. Flag ON, before any recognized+effective key / during pointer use → still baseline.
3. Flag ON + recognized key with an effect → modality `key-navigation`, highlight shows.
4. Flag ON, key modality, then pointer touch → modality `pointer`, highlight cleared same frame.

## Architecture decisions

- **Modality is imperative** (HAZARD 3): new module `src/lib/input/inputModality.ts`
  holds `"pointer" | "key-navigation"` in a module ref with a value-equality bail and a
  subscriber set. No React state in the hot path; no setState-in-effect. The provider
  subscribes once to re-apply the highlight; capture-phase `pointerdown`/`touchstart`
  window listeners flip it back to `pointer`.
- **Highlight is imperative**: the provider toggles `data-key-selected` directly on the
  current item's DOM element (mirrors the existing imperative `element.focus()`), gated on
  `enabled && modality === "key-navigation"`. Removed from the old element on every move.
- **Highlight gate reads the single existing source**: the provider's `enabled` prop is
  `flags.keypad_input_enabled` (App.tsx). No second settings read.
- **Sliders** (HAZARD 1): register the Radix **thumb** (already `tabIndex=0` today, so no
  new affordance) via `useFocusItem`. A keypad `onKeyDown` on the Slider Root —
  composed by Radix with `checkForDefaultPrevented=true` — `preventDefault()`s
  Up/Down to suppress Radix's value step (the global handler still moves focus), and owns
  Left/Right: each press calls the existing `handleValueChange` (draft + label + aria
  update) and a **debounced** single `handleValueCommit`, so a key burst coalesces to one
  device write through the existing `useDeviceBoundSlider` throttle/watchdog. Inert unless
  `keypadFocusId` is set AND the provider is enabled.
- **Dropdowns** (HAZARD 2): `NavigationController.dispatch` returns `ignored` for
  vertical-nav/activate while any dismissible layer is open (back chain stays global). The
  `ConfigItemRow` Select is made controlled (`open`/`onOpenChange`); on open it pushes a
  `popup` `DismissibleLayer` whose `dismiss` closes it, so keypad `back` (keyCode 4, which
  Radix ignores) closes it. Radix natively owns option Up/Down/Enter/typeahead/Escape.
- **Diagnostics** (GAP 4): new `src/lib/diagnostics/keyInputDiagnostics.ts` builds the
  `key-input` `details` and emits via `addLog('debug', …)` only after a cheap
  `loadDebugLoggingEnabled() && !shouldSuppressDiagnosticsSideEffects()` gate (zero
  allocation when off). Global handler logs recognized + unmapped keys (never editable
  passthrough → never typed text); `useT9Input` logs only composer-consumed keys with
  lengths-only `t9State`. Sensitive structure relies on the existing recursive redactor.

## Phases / tasks

- **P1 — Modality + highlight (provider/useFocusItem)** [GAP 1]
  - `inputModality.ts`; extend `FocusNavigationProvider` (modality ref, pointer listeners,
    `refreshHighlight`, context exposes `enabled` + `keymap`); CSS `[data-key-selected]`.
- **P2 — Sliders into the ring** [GAP 2, HAZARD 1]
  - Slider component keypad props + key handling + debounced commit; wire
    HomeCpuSpeedSlider, VolumeControls, ConfigItemRow slider.
- **P3 — Dropdowns into the ring** [GAP 3, HAZARD 2]
  - `NavigationController` layer guard; ConfigItemRow Select controlled + layer + testid +
    trigger registration.
- **P4 — Diagnostics** [GAP 4]
  - `keyInputDiagnostics.ts`; emit from provider + `useT9Input`.
- **P5 — Tests** [GAP 5]
  - Extend lib `focusNavigation.test.ts`; new `inputModality.test.ts`,
    `keyInputDiagnostics.test.ts`; extend `useFocusNavigation.test.tsx`,
    `useT9Input.test.tsx`; new Slider keypad + ConfigItemRow keypad unit tests;
    new `playwright/keypadInput.spec.ts`.
- **P6 — Device harness** [GAP 6]
  - Extend `scripts/android-keypad-smoke.sh` (add keyevents 19/21/66/67/18/9 + assertion);
    new `.maestro/keypad-input-smoke.yaml` (tags `device`,`keypad`; not ci-critical).
- **P7 — Docs**: `docs/keyboard-input.md` + link from `docs/index.md`.
- **P8 — Verify / commit / push / PR / green CI / resolve comments (do not merge).**

## Acceptance criteria

See prompt's ACCEPTANCE CRITERIA 1–19. Tracked in WORKLOG.md against each verification
command.

## Verification commands (record exact output in WORKLOG)

```
npm run format:check:ts
npx tsc --noEmit
npm run lint
npm test
npm run test:coverage
npm run test:e2e
npm run build
npm run maestro:gating         # device-gated; document if no device
```

## Compatibility matrix

| Surface | Flag OFF | Flag ON, pre-key / pointer | Flag ON, key-nav |
|---|---|---|---|
| CTAs (existing) | baseline | baseline | `data-key-selected` on focused CTA; Enter activates |
| Sliders | baseline (thumb already tabbable) | baseline | L/R value (label+aria-valuenow), U/D move focus; one write/burst |
| Dropdowns | baseline | baseline | Enter opens; Radix owns options; back/Esc close |
| Text fields (T9) | passthrough | passthrough | composer consumes digit/star/hash/# |
| Diagnostics | none | none | `key-input` debug logs only when debug logging on |
