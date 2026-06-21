# 0001 — handover

## Context

Driving the **C64U Remote** variant + its Callback 8020 / Sailfish support to
feature-complete and bug-free in small, verified slices. The active input work lives
on branch `feat/keyboard-input`, which carries a large UNCOMMITTED increment: "complete
by construction" reachability (DOM auto-discovery replacing per-CTA `useFocusItem`
opt-in) plus the keypad guidance bar (a modality-gated soft-key + breadcrumb strip).
The previous loop verified that increment is green at the unit/tsc/lint level and added
the one missing component test (the guidance bar). Read, in order:

- `docs/plans/callback8020/ralph/STATE.md` (the fast-start digest)
- `docs/plans/callback8020/handover/backlog.md` (the definition of done)
- The latest Callback entries in root `PLANS.md` / `WORKLOG.md`
- Must-read canonical docs listed in `docs/plans/callback8020/handover/README.md`

## Verified state (proven green right now)

- `npx tsc --noEmit` -> exit 0.
- `npx vitest run tests/unit/lib/input/ tests/unit/components/input/
  tests/unit/hooks/useFocusNavigation.test.tsx
  tests/unit/components/ui/slider.keypad.test.tsx` -> 199 pass (12 files).
- `npm run lint` -> exit 0 (format, eslint, bundle-budgets, stale-names,
  variant:check, feature-flags:check).
- `KeypadGuidanceBar.tsx`: 100% lines/statements/functions, 91.66% branch (was 72.22%).
- NOT run this loop: the full merged unit+E2E coverage gate, Playwright small-screen
  overflow, Waydroid, AOSP emulator. The working tree is uncommitted.

## This session's scope (pick ONE; highest value first)

1. **Per-screen reachability audit under the discovery engine.** Verify each C64U
   Remote surface (Home, Play/Disks, Config, Settings) has every primary CTA reachable
   purely by auto-discovery (no per-CTA `useFocusItem`). Add focused integration tests
   per page (mirror `useFocusNavigation.test.tsx`); note any page still needing
   explicit refinement. Advances backlog "Per-CTA focus-ring registration completeness"
   (currently `[~]`).
2. **Deterministic `back` chain.** Wire close-popup -> leave-menu -> leave-field ->
   navigate-back to real dialogs/menus/fields with integration tests. Advances the
   keypad/T9 touch-free item.
3. **T9 input mode UX.** Add the visible multitap-vs-hostname mode indicator, the `#`
   switch, and a settings/developer profile selector
   (`defaultKeyboard` <-> `commodoreCallback8020`). Advances backlog "T9 input mode UX".

If a CI/quality gate is RED on HEAD, fix that first (it outranks new features).

## Guardrails (do not regress)

- Keep the main `README.md` free of any Callback / Sailfish / C64U Remote references;
  those docs live only under `docs/plans/callback8020/`.
- Keep the full `C64 Commander` variant unchanged except shared, beneficial fixes;
  default variant stays `c64commander`.
- C64U Remote stays Android-only, `INTERNET`-only, no Google services, raw-IPv4
  first-class, all pruned features unreachable.
- No skipped tests, no lowered coverage/lint gates, no warning suppression. Cover new
  branches in `src/lib/input/**`, `useT9Input`, and any gating you add.
- Never overstate validation: use "designed for / validated against Callback 8020
  constraints" unless run on real Sailfish/Callback hardware.
- Decide consciously whether to commit the in-flight `feat/keyboard-input` tree: it is
  a coherent increment and green, but had no per-screen reachability audit when left.
  If you commit, do NOT use a Co-Authored-By trailer; do NOT push.

## Definition of done for the session

- One backlog slice implemented + verified by the relevant layer(s); negative path
  checked for any pruning/gating.
- Run what's relevant: `npm run lint`, the affected `vitest` subset, `npx tsc --noEmit`;
  `npm run test:coverage` / `coverage:gate` only if the change is broad; Playwright
  `playwright/callbackSmallScreen.spec.ts` for layout changes.
- Update `backlog.md`, refresh `docs/plans/callback8020/ralph/STATE.md`, append one
  compact entry each to root `PLANS.md` + `WORKLOG.md`, and write `0002-handover.md`.
