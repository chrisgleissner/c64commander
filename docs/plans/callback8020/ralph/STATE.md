# Callback 8020 / C64U Remote — Ralph STATE digest

Compact, fast-start digest for the next loop. Live evidence (a real gate run) always
wins over this file.

## Latest loop

- Date: 2026-06-20.
- Branch: `feat/keyboard-input` (NOT `feat/introduce-new-variant` from older
  PLANS/WORKLOG entries; the active input work moved here).
- Slice: added the missing dedicated component test for the keypad guidance bar to
  defend the 91% coverage gate on the in-flight discovery+guidance increment.
- Verdict: SLICE COMPLETE (test-only addition, all relevant gates green).

## Branch state (important)

The working tree carries a LARGE UNCOMMITTED prior-loop increment plus this loop's
test. It is one coherent architectural step but was not authored this loop and lacks
a full per-screen reachability audit, so it is intentionally left uncommitted for the
operator/next loop to seal.

In-flight increment ("complete by construction" reachability + guidance bar):
- `src/lib/input/discovery.ts` (new) — DOM scope resolution + interactive-element
  discovery; the ring is built by scanning the active scope, so `useFocusItem` is now
  optional refinement, not the reachability mechanism.
- `src/lib/input/focusDiscovery.ts` (new) — `FocusDiscoveryEngine` (MutationObserver,
  tabindex shims, scope chain, `setItems`).
- `src/lib/input/guidance.ts` (new) — PURE soft-key/breadcrumb label policy.
- `src/components/input/KeypadGuidanceBar.tsx` (new) — imperative React adapter that
  writes the resolved labels to the DOM (no React state; mirrors `refreshHighlight`).
- `src/hooks/useFocusNavigation.tsx` (453-line refactor) — provider wires the engine,
  renders the guidance bar, exposes `subscribeRingChange`.
- Plus `src/index.css`, `TabBar.tsx`, `SummaryConfigCard.tsx`, `src/lib/input/index.ts`.

## What is green right now (verified this loop)

- `npx tsc --noEmit` -> exit 0.
- `npx vitest run tests/unit/lib/input/ tests/unit/components/input/
  tests/unit/hooks/useFocusNavigation.test.tsx
  tests/unit/components/ui/slider.keypad.test.tsx` -> 199 pass (12 files).
- `npm run lint` -> exit 0 (format, eslint, bundle-budgets, stale-names,
  variant:check, feature-flags:check).
- `KeypadGuidanceBar.tsx` coverage: 100% lines/statements/functions, 91.66% branch
  (was 72.22%). The two remaining uncovered branches (lines 70, 91) are defensive
  `useRef(null).current` guards unreachable through the component.

## NOT yet run (next loop should consider)

- Full merged unit+E2E coverage gate (`npm run coverage:gate`) — needs Playwright;
  reserve for a milestone close or a broad change.
- Playwright small-screen overflow spec, Waydroid, AOSP emulator — n/a this loop (no
  layout/packaging change), still owed before sealing the input work.
- A per-screen reachability audit under the discovery engine (Play/Disks/Config/
  Settings reachable WITHOUT per-CTA `useFocusItem`).

## Next recommended slice

1. Per-screen reachability audit under the discovery engine (verify each page's CTAs
   are reachable purely by auto-discovery), then decide whether residual `useFocusItem`
   calls are still needed.
2. Deterministic `back` chain wired to real dialogs/menus/fields (close popup -> leave
   menu -> leave field -> navigate back) with integration tests.
3. T9 input mode indicator (multitap vs hostname) + `#` switch + profile selector.

## Key file mtimes (for staleness checks)

- src/lib/input/discovery.ts        2026-06-20 20:11
- src/lib/input/focusDiscovery.ts   2026-06-20 20:31
- src/lib/input/guidance.ts         2026-06-20 21:27
- src/components/input/KeypadGuidanceBar.tsx          2026-06-20 21:27
- src/hooks/useFocusNavigation.tsx  2026-06-20 20:22
- tests/unit/components/input/KeypadGuidanceBar.test.tsx  2026-06-20 21:56 (new)
