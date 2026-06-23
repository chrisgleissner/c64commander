# Menu ⇄ Config mapping layer — PLANS

> Task-local plan. Do **not** touch the repo-root `PLANS.md`/`WORKLOG.md`.
> Worklog lives beside this file: `WORKLOG.md`.

## Goal

Present device configuration with familiar **device-menu terminology** (and, for
C64U, the captured menu **hierarchy**) while keeping the REST API the internal
source of truth. Two non-negotiable invariants:

1. **Lossless / no static gating** — the Config page renders *every* item live
   `GET /v1/configs` returns, on every device (C64U, U64, U2, unknown/future),
   with no allow-list / family literal / category roster deciding what shows.
2. **C64U terminology is a source, not a gate** — C64U menu labels are reused
   wherever any device exposes the same REST `{category,item}`, but no item must
   be "known to the menu" to render.

## Architecture (two independently-applied layers)

| Layer | Keyed by | Source | Applies on |
|---|---|---|---|
| **A. Terminology overlay** — `{label, formatterId}` per item | REST `{category,item}` | C64U menu YAML | **Every** device |
| **B. Menu hierarchy** — menu page/section grouping + aliases | `family+firmwareVersion` | Captured menu YAML (only C64U 1.1.0) | Only when a menu resolves; else REST-grouped layout |

Both layers derive from ONE compiled source per family/version.

## Pipeline (mirrors the feature-flags convention)

```
docs/c64/devices/c64u/1.1.0/c64u-menu.yaml        (hierarchy + labels + kinds — existing)
src/lib/config/menuMapping/c64u-1.1.0.association.yaml   (NEW: REST pointers + formatters + flags, path-keyed)
        │  scripts/compile-menu-mapping.mjs  (reads menu YAML + association, validates vs c64u-config.yaml)
        ▼
src/lib/config/menuMapping/c64u-1.1.0.generated.ts (COMMITTED): exports HIERARCHY (Layer B) + OVERLAY (Layer A)
        │
        ├─ resolveMenuMapping({family,firmwareVersion}) → hierarchy | null   (src/lib/config/menuMapping/resolveMenuMapping.ts)
        ├─ TERMINOLOGY_OVERLAY (device-agnostic)                              (src/lib/config/menuMapping/overlay.ts)
        └─ projectConfigToMenu(liveRest, {hierarchy, overlay}) → {tree, drift} (src/lib/config/menuMapping/projectConfigToMenu.ts)
                    │
                    ▼  consumed by src/pages/ConfigBrowserPage.tsx
```

## Phases

- [x] **P1 — Mapping artifact.** Author `c64u-1.1.0.association.yaml` (path→restPointer,
  formatterId, alias/menuOnly flags). Write `scripts/compile-menu-mapping.mjs`
  (`--check`) + generated TS. Wire `menu-mapping:compile`/`:check` into prebuild/lint.
  Draft the association with a scratchpad auto-matcher, then review/commit explicitly.
- [x] **P2 — Resolver + projection (pure, node-tested).** `resolveMenuMapping`
  (exact→nearest-lower→latest→null, never cross-family). `projectConfigToMenu`
  (hierarchy branch + null branch; Layer A applied in both; unmapped→fallback;
  stale→drop+record; menu-only→non-persistent; lossless set-equality assertion).
- [x] **P3 — Drift checker + tests.** `--check` validates C64U hierarchy vs C64U
  config sample only; fails on unmapped-not-allowlisted / stale / label drift /
  leaf-without-pointer-or-menuOnly. Unit test asserts "no drift for 1.1.0".
- [x] **P4 — Page integration: Layer A everywhere + resolver switch.** Apply overlay
  labels/formatters in the existing `CategorySection` (no-hierarchy path). Re-key
  `useAuthoritativeConfigValueState` by canonical `category::item`. Page chooses
  hierarchy vs REST-grouped via `resolveMenuMapping`.
- [x] **P5 — Layer B menu rendering.** New `MenuPageSection` (multi-category fetch,
  sub-sections, aliases share one REST source) + "Advanced (REST-only) settings"
  fallback section rendering every unclaimed live item (partial-category leftovers
  included). Audio Mixer menu page delegates to existing specialized CategorySection
  (preserves solo/reset). Preserve PUT-single-write, throttle, routing-epoch, DHCP.
- [x] **P6 — Home/Play/Disks audit.** Minimal, low-risk reconciliation only.
- [x] **P7 — Tests + validation + docs.** Lossless set-equality over C64U 1.1.0/3.14
  + U64e 3.12a/3.14e + synthetic unknown category; alias write identity; fallback
  write identity; formatter tests; resolver fallback chain; README.
- [x] **P8 — HIL device testing (Pixel 4 + c64u, u64 fallback).** After all changes,
  exercise on real hardware the CTAs/features touched by the mapping: Config menu pages
  (Video setup, Turbo boost, Audio setup, LED lighting, Network, Drives), the Advanced
  (REST-only) fallback, alias edits (drive ROMs), relabeled controls, and value
  formatters. Probe u64 first; re-probe c64u before cross-device proofs ([[c64u-flakiness]]).
- [x] **P9 — Recapture affected screenshots.** Recapture every screenshot affected by the
  relabel/regroup (Config page + any Home/Play/Disks surfaces touched). Honor the
  test-change litmus + CI evidence (PNG+video) conventions.
- [x] **P10 — Dissolve the Advanced (REST-only) fallback via smart heuristics.** Route each
  unclaimed item into its most-aligned menu page using resilient keyword/known-category
  heuristics (no over-engineering). Hide the Advanced folder entirely when empty — it must
  never read as a junk drawer. Then re-capture all screenshots changed by this.

## Key files to touch

- NEW: `src/lib/config/menuMapping/{c64u-1.1.0.association.yaml,c64u-1.1.0.generated.ts,
  types.ts,overlay.ts,resolveMenuMapping.ts,projectConfigToMenu.ts,menuValueFormatters.ts,humanize.ts,index.ts}`
- NEW: `scripts/compile-menu-mapping.mjs`
- EDIT: `src/pages/ConfigBrowserPage.tsx`, `src/components/ConfigItemRow.tsx` (already has
  `label`/`formatOptionLabel`/`readOnly` — injection points), `src/hooks/useAuthoritativeConfigValueState.ts`
  (re-key category::item), `package.json` (lint/prebuild chain), `src/lib/config/sidDetails.ts`
  (export `formatAddressValue`).

## Termination criteria

`npm run typecheck` + `npm run lint` (incl. `menu-mapping:check`) + `npm test` green;
lossless set-equality tests pass for all four fixtures + synthetic unknown; write-back
asserts canonical `{category,item}` under primary + alias + fallback edits; coverage gate
(91/91) held. WORKLOG records exact commands + results.
