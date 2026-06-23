# WORKLOG — menu ⇄ REST config mapping hardening

All times 2026-06-23 (local). Prior task content for this file is in git history.

## P0 — baseline + evidence inventory

- Branch `feat/align-ux-with-device-menu`; large uncommitted feature tree (untracked
  `src/lib/config/menuMapping/`, `src/pages/config/`, `scripts/compile-menu-mapping.mjs`,
  `scripts/menu-mapping/`, tests, generated TS, screenshots).
- Architecture (verified by reading source, not the prior report):
  - **Layer A overlay** (`overlay.ts`, `types.ts`): `{category→{item→{label,formatterId}}}`,
    device-agnostic, applied on every device, first-writer-wins merge.
  - **Layer B hierarchy** (`resolveMenuMapping.ts`): registry keyed by family+firmware;
    C64U 1.1.0 only; never crosses families; `null` → REST-grouped layout. Intra-family
    version fallback (exact → nearest-lower → latest).
  - **Projection** (`projectConfigToMenu.ts`): pure, computed over LIVE data; lossless
    (`renderedRestKeySet == liveRestKeySet`); stale pointers dropped not errored.
  - **Routing** (`advancedRouting.ts`): keyword (U64-Specific topic split) → sole-owner
    (data-derived) → category default (per family). Page renderer
    (`MenuPageSection`/`AdvancedFallbackSection`) consumes the SAME routing functions, so
    the pure projection and the runtime agree (no divergence).
  - **Write-back** (`useConfigLeafWrite.ts`): canonical `{category,item}` via `setConfig`
    → PUT (single-item; POST is the device-crash path). Aliases share one optimistic cell
    keyed by `canonicalConfigKey` (`ConfigLeafRow`).
  - **Compiler** validates: stale paths, duplicate paths, unknown formatters, conflicting
    primary labels, alias-without-primary, mapped/intentional items exist in the config
    sample, and **completeness** (every config item mapped OR intentionallyUnmapped).
    `--check` is wired into `npm run lint`.
- Claim checks:
  - Prior report "did not modify repo-root PLANS.md/WORKLOG.md" — TRUE: both tracked,
    last touched at `6bfb766a` (previous feature), no working-tree diff. Updated here.
  - "Advanced fallback dissolved" — FALSIFIED as stated: it is not dissolved by design,
    it is *populated by speculative category defaults* so it renders empty on C64U. See P2.
- Baseline gates: `menu-mapping:check` OK (179 items, 16 menu-only). Targeted suite
  (7 files / 47 tests) green.

## P1 — verification matrix

`projectConfigToMenu.test.ts` already proves the lossless set-equality on real fixtures:
C64U 1.1.0 (hierarchy), C64U 3.14 (intra-family fallback + stale ref), U64e 3.12a / 3.14e
(null → REST-grouped), a synthetic never-seen category ("Audio Output Settings", a U2
stand-in) → fallback with intact write identity, drive-ROM alias dedup, menu-only nodes.
`ConfigBrowserPageMenuMode.test.tsx` proves the runtime: menu pages render, menu labels
applied, write-back uses canonical `{category,item}`, alias rows share the source.
Matrix rows all covered; extended the routing assertions in P2.

## P2 — advanced-routing adversarial review

Evidence gathered from `c64u-menu.yaml` (label/structure authority) + `c64u-config.yaml`
(REST schema):
- `c64u-menu.yaml` has NO Tape page, NO `C64U Model`, NO SoftIEC/Data-Streams page
  (only Audio Mixer "Vol/Pan tape *" volume rows mention "tape").
- `intentionallyUnmapped` leftovers reach routing: `C64U Model`, SoftIEC (`IEC Drive`,
  `Soft Drive Bus ID`, `Default Path`), `Tape Playback Rate`, Data Streams (`Stream * to`,
  `Debug Stream Mode`), plus keyworded U64-Specific items + sole-owned C64/Cartridge leftovers.
- The `categoryDefaults` tier placed WHOLE categories on a page with no captured-menu
  evidence: `U64 Specific Settings→Video setup` (caught only `C64U Model`),
  `SoftIEC→Built-in drive A`, `Tape→Built-in drive A`, `Data Streams→Network`. These are
  exactly the "too broad / likely to misplace future items" rules the brief flags.

Defect: `Tape Playback Rate` rendered on "Built-in drive A" (cassette setting on the disk
drive page) and `C64U Model` (hardware edition) on "Video setup" — both misleading, neither
evidence-backed.

Fix: removed all `categoryDefaults` (kept the field as an empty, documented extension
point). Kept the evidence-based tiers: keyword rules (topical split of the one multi-owner
category — HDMI→Video, user-port→Joystick, drive-comms→Built-in drive A) and sole-owner
derivation (a category genuinely claimed by exactly one page). Unplaceable leftovers
(`C64U Model`, SoftIEC, Tape, Data Streams) now render in the residual, explicitly-labelled
**Advanced (REST-only) settings** section — lossless, canonical write-back, self-hiding when
empty (invariant #7). Keyword routing of HDMI Tx Swing/Adjust Color Clock/UserPort/Serial
Bus/SpeedDOS/Burst Mode is unchanged (topically correct).

Tests updated to encode the evidence-based behavior (placement assertions changed; lossless
set-equality unchanged): `advancedRouting.test.ts`, `projectConfigToMenu.test.ts`,
`ConfigBrowserPageMenuMode.test.tsx`.

## P3 — `Disk swap delay` / `Loop delay` units

Sources checked: `c64u-config.yaml` (REST schema), `c64u-3.14`/`u64e-*` configs, menu YAML,
`menuValueFormatters.ts`, `ConfigItemRow.tsx`, `normalizeConfigItem.ts`, association YAML.

Verified from the firmware REST schema `format` field (printf-style):
- `Disk swap delay` (Drive A/B): `min:1 max:10 format:"%d00 ms"` → display `value*100 ms`
  (1→"100 ms" … 10→"1000 ms").
- `Loop Delay` (Modem Settings): `min:1 max:20 format:"%d0 ms"` → display `value*10 ms`
  (2→"20 ms" … 20→"200 ms").

Root cause of "raw": `ConfigItemRow` fetches `format` into `mergedDetails` but **never uses
it** (dead memo, line ~176); `inferControlKind` keys only off options, so a min/max/format
item with no options renders as a raw text input. This is app-wide — ~108 items across the
sampled configs carry a `format` string (`%d`, `%d00 ms`, `%02d`, `%d ppm`, `%d0 ms`,
`%02x`, `%d00`). Honoring `details.format` generically would change rendering for all of
them (control-kind + slider/label) — a broad shared-control change, out of this feature's
scope and not a menu-mapping concern.

Disposition: keep RAW. A hardcoded ×100/×10 multiplier in the menu overlay would be the
wrong layer (duplicating device-provided `format`) AND ineffective (these items have no
options, so `formatOptionLabel` never fires). Added a regression test that pins raw display
and raw write-back for both items, and documented the verified unit + the dead-code finding.
No multiplier invented.

## P4 — overlay/label cleanup

Audited the generated overlay labels: already natural sentence case (menu-YAML-sourced:
"CPU speed", "HDMI scan resolution", "Analog video mode", "Auto save config"). No stale
source-reference annotations, no spurious title-case. C64U/U64/U2 terminology consistent.
Minimal change.

## P5 — source pipeline + authoring cleanup

Compiler is deterministic + drift-checked (verified `--check` fails on a hand-edited
generated file). Updated `README.md` + `SKILL.md` to describe the evidence-based routing
(no speculative whole-category defaults; unplaceable → residual Advanced). `restKey`
separator robustness reviewed (see findings).

## P6 — UI integration review

- Hierarchy mode selected only when `resolveMenuMapping` returns non-null; else REST-grouped.
- Layer A overlay applied in both layouts (`ConfigBrowserPage` passes `TERMINOLOGY_OVERLAY`;
  `FallbackCategoryBlock` uses `resolveOverlayEntry`).
- Lazy per-category fetch preserved (`useC64Category` gated on `isOpen`/`active`); each
  `MenuBlock` fetches exactly one category → stable hook usage (no hooks-in-a-loop).
- Aliases share the optimistic store via `canonicalConfigKey`.
- Audio Mixer keeps the specialized `CategorySection` (solo/reset/BUG-033) — routed by
  `soleRestCategory(page)==="Audio Mixer"`.
- U64E-only `Clock Settings` renders editable in REST-grouped mode (proved in projection test).

## P7 — E2E / screenshots / HIL

E2E impact of the P2 routing change (audited every spec):
- `demoConfig.spec.ts` — encoded the old "junk drawer dissolved" behavior
  (`config-advanced-fallback` count 0). The demo config is `docs/c64/c64u-config.yaml`,
  which DOES contain the now-residual categories (C64U Model, SoftIEC, Tape Settings,
  Data Streams). Updated the spec: the residual Advanced (REST-only) section is now present
  and shows `Tape Playback Rate` (litmus test: the new behavior is the intended,
  evidence-based one — the spec encoded the removed speculative placement).
- `configEditingBehavior.spec.ts` — UNAFFECTED: it relies on `Clock Settings` rendering in
  the residual fallback (Clock Settings was never in `categoryDefaults`, so it always routed
  to residual — before and after).
- `solo.spec.ts`, `navigationBoundaries.spec.ts`, `ui.spec.ts`, `configVisibility.spec.ts`,
  `keypadInput.spec.ts`, `homeInteractivity.spec.ts` — UNAFFECTED (assert mapped items
  System Mode / drive page / Data-Streams-as-home-mock; none depend on the removed defaults).
- `screenshots.spec.ts` — captures config sections generically (including the
  `config-advanced-fallback-toggle` → `advanced-rest-only` slug). With the residual section
  now present in demo mode it will capture an `advanced-rest-only` screenshot again; the
  catalog is a blob-diff tracker, not a fixed required list, so a new capture does not fail it.

HIL (real hardware on the local network, 2026-06-23):
- **Ultimate 64 Elite — REACHABLE, no auth.** `http://u64` → `/v1/info` product
  "Ultimate 64 Elite", firmware 3.14e, fpga 122, hostname u64. `GET /v1/configs` returns 19
  live categories incl. the U64e-only `Clock Settings`, SoftIEC, Tape, Data Streams, U64
  Specific. `normalizeKnownProduct("Ultimate 64 Elite")` → `u64e` → family `U64E` →
  `resolveMenuMapping` returns null → **REST-grouped layout** (Layer A overlay still applies).
  This is the null-hierarchy path; my C64U-only routing change does not affect it. The
  lossless REST-grouped rendering of this exact category shape (incl. Clock Settings,
  editable) is unit-proven over the matching `u64e-3.14e` fixture.
- **C64U — REACHABLE but 403 (password-protected).** `http://c64u/v1/version` → 403. No C64U
  credential is present in the environment, and I did not attempt to bypass it. The
  C64U-specific change (the residual Advanced section) can therefore only be visually
  validated on a real C64U → **BLOCKED by an external dependency (credentials)**, recorded
  as such, NOT a pass. Its rendering is validated by the unit suite + the updated
  `demoConfig` E2E over the real `c64u-config.yaml` fixture (the fixture-fallback path).
- Pixel `9B081FFAZ001WX` has the app (`uk.gleissner.c64commander`) installed; a full
  build+install+screenshot in demo mode was not run (the demo-mode rendering is covered by
  the E2E demo spec over the same fixture).

Screenshots: the C64U/demo config surface gains a residual Advanced (REST-only) section, so
the committed docs section PNGs for the config surface are candidates for recapture (P5).
The prior `advanced-rest-only` screenshot was removed under the old "dissolved" design; it is
legitimately reintroduced by this change.

## P9 / P10 — appended as they run
