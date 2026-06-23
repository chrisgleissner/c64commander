# Menu ⇄ Config mapping layer — WORKLOG

Factual running notes: decisions, files changed, commands run, results, risks.

## Research (pre-implementation)

### Cross-device REST category/item census (from fixtures)
Extracted with a Python `yaml.safe_load` over each fixture. Confirms heavy,
permanent drift — justifies the no-static-list invariant:

- **C64U 1.1.0**: Audio Mixer(20), Speaker Mixer(11), SID Sockets Configuration(8),
  UltiSID Configuration(8), SID Addressing(8), U64 Specific Settings(22),
  C64 and Cartridge Settings(19), SoftIEC Drive Settings(3), Printer Settings(11),
  Network Settings(14), Ethernet Settings(5), WiFi settings(5), Tape Settings(1),
  LED Strip Settings(7), Keyboard Lighting(7), Drive A/B Settings(13),
  Data Streams(4), Modem Settings(16), User Interface Settings(6).
- **C64U 3.14**: same categories; LED Strip/Keyboard Lighting drop `LedStrip Auto SID
  Mode` (→6); Modem drops `Automatic Rx Pushback` (→15). Exercises intra-family
  version fallback + unknown/changed-item routing.
- **U64e 3.12a / 3.14e**: NO Speaker Mixer, NO Keyboard Lighting. HAS `Clock Settings`(7,
  manual RTC). `WiFi settings` adds `WiFi Enabled`. `User Interface Settings` items
  differ entirely (3.12a has Background/Border/Foreground color…). 3.14e adds
  `Track Twist` to drives, `Mouse Mode/…` + `Speaker Enable` to U64 Specific Settings,
  `LedStrip Type/Length` to LED Strip. LED Strip 3.12a uses `Fixed Color
  Red/Green/Blue` (not `Fixed Color`/`Color tint`).

⇒ Same REST `{category,item}` identity recurs across families ⇒ Layer A labels are
reusable; no captured sample predicts a device's live category set.

### Menu YAML structure (c64u-1.1.0)
`config.menu_tree` (top hierarchy; `Audio setup` uses `children`, others `category`)
+ `config.categories.<MenuCategory>` each with `menu_path`, `kind`, nested `items`
(`kind: section|action|password|file_picker`). **Labels already corrected** in the
YAML (e.g. `Vol UltiSID 1`, `Vol socket 1`, `BASIC ROM`, `Static netmask`), so the
menu YAML is the authoritative label source for Layer A — no separate case table.

### Code grounding (confirmed)
- `ConfigItemRow` already exposes `label`, `labelClassName`, `formatOptionLabel`,
  `readOnly`, `valueClassName`; `displayLabel = label ?? name`; control-type inference
  + write-back key off REST `name`/`category`. → clean injection point.
- `ConfigBrowserPage` → `useC64Categories()` (string[]) → `CategorySection` per category;
  lazy `useC64Category(name, isOpen)`; `extractConfigItems`; per-item `ConfigItemRow`.
  Specializations: Audio Mixer solo/reset (BUG-033 machinery), Clock `Sync clock`,
  DHCP static-field disabling, CPU Speed read-only (in ConfigItemRow).
- `useAuthoritativeConfigValueState` keyed by **itemName** (per-CategorySection). Must
  re-key by `category::item` (collides for multi-category menu pages e.g. LED lighting:
  LED Strip Settings + Keyboard Lighting both expose `LedStrip Mode`/`Strip Intensity`).
- Write path: `setConfigValue` → PUT single (must stay PUT); `updateConfigBatch` → PUT
  for single, POST for true multi. Routing-epoch keys all reads.
- Family/firmware available at `useC64Connection().status.deviceInfo`
  (`product`/`firmware_version`/`core_version`); family via
  `resolveCanonicalProductFamilyCode(product)`.
- `formatDbValue` already trims `" 0 dB"`→`"0 dB"`; `formatPanValue`; `formatAddressValue`
  is **local (unexported)** in `sidDetails.ts` → will export for reuse.
- Generated-source convention: `feature-flags.yaml` → `compile-feature-flags.mjs`
  (`--check`) → `*.generated.ts` (committed) → consumer → `feature-flags:check` in
  `npm run lint`; `js-yaml` `^4`; node tests live in `tests/unit/scripts/**` (unit-node).

## Decisions

- **D1** Association is **path-keyed** (`[MenuCategory, …section, leaf]` → restPointer)
  so display labels stay solely in the menu YAML; association keys are validated join
  keys. Generated TS pulls `displayLabel` from YAML.
- **D2** Reuse existing `CategorySection` (with all safeguards) for: no-hierarchy mode,
  the Audio Mixer menu page, and hierarchy-mode fallback groups (subset filtering). New
  `MenuPageSection` only for multi-category / sub-sectioned menu pages.
- **D3** ms-suffix items (`Disk swap delay`, `Loop Delay`): pending firmware
  verification — see open item below. Default to raw value, no multiplier.

## Open items / risks
- [ ] Verify `Disk swap delay`/`Loop Delay` units vs `1541ultimate` firmware before
  applying any multiplier (D3).
- [ ] Alias pending-state sharing across two expanded pages requires a page-level shared
  authoritative store keyed by `category::item`.

## P1 — mapping artifact + compile pipeline (DONE)
- Authoring aid `scripts/menu-mapping/draft_association.py` (reusable per family; RULES
  block + generic mechanics) drafts the association by normalized label↔REST-item match.
  Result: **179 mappings, 16 menu-only, 0 unmatched**; unmapped REST items exactly match
  the prompt's advanced/REST-only lists (C64U Model, HDMI Tx Swing, Bus Sharing*, SoftIEC,
  Tape, Data Streams, LedStrip SID Select, …) → 28 intentionallyUnmapped.
- Committed source `src/lib/config/menuMapping/c64u-1.1.0.association.yaml` (path-keyed).
- `scripts/compile-menu-mapping.mjs` (mirrors compile-feature-flags): reads menu+assoc,
  validates vs `c64u-config.yaml`, emits committed `c64u-1.1.0.generated.ts`
  (`C64U_1_1_0_HIERARCHY` Layer B + `C64U_1_1_0_OVERLAY` Layer A). Validations: stale
  path, missing REST pointer, leaf-without-mapping-or-menuOnly, overlay primary/alias
  consistency, and the C64U-only drift check (every config item mapped OR
  intentionallyUnmapped). `intentionallyUnmapped` is dev-time only — NOT read at runtime.
- npm: added `menu-mapping:compile`/`:check`; compile into prebuild/predev/prestart,
  check into `lint`.
- `formatAddressValue` exported from `sidDetails.ts` for `menuValueFormatters` reuse.
- Per user request: the Python authoring scripts are preserved in `scripts/menu-mapping/`
  (canonical regenerator) and documented by the AI skill
  `.github/skills/menu-mapping-authoring/SKILL.md`.

Commands:
- `node scripts/compile-menu-mapping.mjs` → "C64U 1.1.0 — 179 items, 16 menu-only" ✓
- `node scripts/compile-menu-mapping.mjs --check` → pass ✓
- top-level node order verified == menu_tree; overlay spot-checks correct
  (Vol UltiSid 1→"Vol UltiSID 1"+db, CPU Speed→"CPU speed"+cpuSpeedMhz, TimeZone→"Timezone").

## P2 — resolver + projection (DONE, pure node-tested)
- `overlay.ts` (device-agnostic merge), `resolveMenuMapping.ts` (exact→nearest-lower→
  latest→null; never cross-family; `compareFirmwareVersions` tolerant of `3.14e`),
  `projectConfigToMenu.ts` (hierarchy + null branches; Layer A in both; unmapped→fallback
  computed as `live − claimed`; stale dropped+recorded; menu-only non-persistent;
  `renderedRestKeySet`/`liveRestKeySet` for lossless assertions). `index.ts` barrel +
  `claimedItemsForCategory`.
- Tests (`tests/unit/lib/config/menuMapping/`, 30): **lossless set-equality over c64u
  1.1.0 + 3.14 + u64e 3.12a + 3.14e + a synthetic unknown category** all pass; splits,
  aliases (deduped single identity), fallback, menu-only, Layer-A-in-null-branch, resolver
  chain, formatters, humanizer.

## P3 — drift checker (DONE)
- `compileMenuMapping({check, targets})` exported for testing. `tests/unit/scripts/
  compileMenuMapping.test.ts` (6, unit-node): committed state drift-free + 4 negative
  cases (unmapped leaf / stale path / absent REST item / completeness) bite.

## P4+P5 — page integration (DONE)
- `useAuthoritativeConfigValueState`: added `clearMatching(prefix)` + `canonicalConfigKey`
  + `AuthoritativeConfigValueState` type. Store LIFTED to ConfigBrowserPage (page-shared),
  keyed `category::item` (fixes multi-category collision e.g. LED Strip vs Keyboard
  Lighting both exposing `LedStrip Mode`; aliases share one cell).
- New `src/pages/config/`: `useConfigLeafWrite` (PUT single-write + optimistic),
  `ConfigLeafRow`, `menuBlocks` (buildMenuBlocks — KEY INSIGHT: every menu section/intro
  group is single-REST-category, so each block = one lazy `useC64Category` fetch →
  hook-safe, no hooks-in-loop), `MenuBlock`, `FallbackCategoryBlock`, `MenuPageSection`,
  `AdvancedFallbackSection`.
- `ConfigBrowserPage`: resolves hierarchy from `status.deviceInfo`
  (`resolveCanonicalProductFamilyCode(product)` + `firmware_version`). Hierarchy → menu
  pages (Audio Mixer page delegates to the specialized CategorySection to keep solo/reset)
  + Advanced fallback. Null → today's CategorySection list. BOTH apply Layer A overlay.
  CategorySection edits surgical: accept shared store + overlay + displayTitle/groupLabel,
  canonical keys, `clearAll`→`clearMatching(\`${cat}::\`)`.
- Existing `ConfigBrowserPage.test.tsx` (26) green unchanged (mocked conn has no
  deviceInfo → unknown family → null hierarchy → REST-grouped path preserved).
  New `ConfigBrowserPageMenuMode.test.tsx` (4): menu pages + group label + fallback render;
  menu relabel + canonical write identity; drive-ROM alias writes ONE Drive A Settings
  source from both locations; advanced/fallback item editable with canonical PUT.

## P6 — Home/Play/Disks audit (DONE — no changes, documented)
- Home/Play key off REST identity (`"U64 Specific Settings::System Mode"`, `"CPU Speed"`,
  `"Vol UltiSid 1"`) for write-back + option-domain fallbacks; their display labels are
  bespoke, design-specific strings with their own tests/screenshots. `HOME_CONFIG_OPTION_
  DOMAINS`/`DRIVE_CONTROL_SPECS`/`STREAM_LAYOUT` are OPTION/spec maps, not label overlays —
  no genuine label duplication. Reconciling would add screenshot/test churn for marginal
  gain ⇒ per the prompt's risk guidance, **left unchanged**. Disks uses the source
  abstraction (Local/C64U/HVSC/CommoServe), not storage roots — untouched. `Data Streams`
  not hidden (renders in fallback).

## P7 — docs (DONE)
- `docs/research/menu-config-mapping/README.md` (Layer A vs B split, degradation ladder,
  pipeline, how-to-add-a-family recipe, canonical-identity invariants).

## Validation commands + results
- `npx tsc -p tsconfig.app.json --noEmit` → exit 0.
- `npx vitest run tests/unit/lib/config/menuMapping/ …` → 30 pass.
- `npx vitest run tests/unit/scripts/compileMenuMapping.test.ts` → 6 pass.
- `npx vitest run tests/unit/pages/ConfigBrowserPage*.test.tsx` → 26 + 4 pass.
- config-related batch (82 files / 773 tests) → all pass.
- `npm run lint` → PASS (format, eslint, typecheck, display-profiles, bundle-budgets [web
  build OK], stale-names, variant:check, feature-flags:check, **menu-mapping:check**).

## Full validation + E2E migration + screenshots (DONE)
- `npm test` (full vitest) → **640 files / 7446 tests pass, exit 0** (no unit regressions).
- E2E: discovered the mock `/v1/info` reports `product: "C64 Ultimate"` ⇒ demo + all
  mock-server E2E correctly render the **menu hierarchy** (the intended C64U UX). Migrated
  the config-touching specs from REST-category navigation to menu pages (canonical REST
  identity preserved, so state/PUT assertions unchanged):
  - `demoConfig`, `configVisibility` (×2), `ui` (×3), `solo`, `keypadInput`,
    `navigationBoundaries`, `configEditingBehavior` (Clock Settings → Advanced fallback).
  - Pattern: `getByRole("button",{name:"U64 Specific Settings"})` → `getByTestId(
    "config-menu-page-video-setup")`; Audio Mixer keeps `config-category-audio-mixer`
    (delegated to CategorySection); `getByLabel("System Mode select")` survives
    case-insensitively vs the relabelled "System mode".
  - Verified: batch of 8 specs → **25 passed**; sweep of 7 more → **70 passed**; 0 failures.
    Golden traces (navigationBoundaries/configVisibility) re-pass — REST endpoints unchanged.
- New component test `ConfigBrowserPageMenuMode.test.tsx` (4) covers menu pages + fallback
  + relabel + canonical write + alias one-source.
- **Screenshots (P9)**: migrated `captureConfigSections` to derive section slug from the
  toggle testid (`config-menu-page-*` / `config-category-*` / advanced fallback); reset the
  `screenshot-catalog.json` `config` order to menu-page order; deleted stale REST-category
  section PNGs; recaptured → `docs/img/app/config/sections/01-memory-roms…20-advanced-rest-only.png`
  + `01-categories.png` + 4 profile overviews. Visually verified (menu hierarchy + "AUDIO
  SETUP" group + relabelled "System mode/HDMI scan resolution/…"). Updated README config
  thumbnails (`03-video-setup.png`, `04-audio-mixer.png`).

## P8 — on-device HIL (Pixel 4) (DONE)
- Built + installed the debug APK with this branch's code (`npm run android:apk` →
  `c64commander-0.8.9-6bfb7-debug.apk`, `adb install -r -d`). App launches as
  `uk.gleissner.c64commander` (v0.8.9-6bfb7).
- c64u is reachable but **password-protected (HTTP 403)** so the app can't connect → the
  C64U menu-hierarchy device couldn't be exercised live (validated instead via the
  real-app E2E screenshots). u64 (`Ultimate 64 Elite`, U64E, 3.14e) reachable (HTTP 200);
  switched the app to it (badge → "U64 ● HEALTHY").
- On the real u64: Config renders the **REST-grouped layout** (correct — U64E → null
  hierarchy), incl. the U64e-only `Clock Settings`; lazy per-category fetch works;
  **Layer A relabel applied on real hardware** — UltiSID Configuration shows
  "UltiSID 1 filter curve" (overlay label, lowercase) not the REST "UltiSID 1 Filter
  Curve". Confirms the device-agnostic overlay + no-hierarchy degradation path live.

## P10 — dissolve the Advanced fallback via smart heuristics (DONE)
- `src/lib/config/menuMapping/advancedRouting.ts`: `routeAdvancedItem` (3 tiers —
  category-scoped keyword rules → data-driven sole-owner derivation → per-family category
  defaults), `advancedCategoriesForPage`, `unroutedCategories`. C64U: 16 sole-owner
  categories routed for free; U64 Specific split by keyword (HDMI/colour→Video,
  userport→Joystick, serial/parallel/burst→Built-in drive A); no-owner categories homed
  (SoftIEC/Tape→Built-in drive A, Data Streams→Network). **All C64U leftovers route → the
  residual Advanced section dissolves entirely.**
- Projection: `ProjectedPage.advanced` (routed groups); `fallback` now = residual
  (route→null) only; `ProjectionContext.family`. Pages render routed items under an
  "Advanced" sub-header (reusing `FallbackCategoryBlock` with an `accept` predicate);
  `AdvancedFallbackSection` renders only residual categories; `ConfigBrowserPage` omits it
  when `unroutedCategories` is empty (cheap, from the category list — no eager fetch).
- Resilient + lossless: unknown/future category (no owner/keyword/default) → residual
  reappears; unknown item in a routed category → routes to that category's home page.
- Tests: `advancedRouting.test.ts` (7); projection "smart-routing DISSOLVES the fallback"
  (residual empty, items on correct pages); component "smart-routes … onto aligned pages,
  no junk drawer"; demoConfig E2E asserts `config-advanced-fallback` count 0.
- Re-screenshot: reset catalog to 19 menu pages, recaptured → `01-memory-roms…
  19-built-in-drive-b.png` (no `*-advanced-rest-only.png`; pages now carry "Advanced"
  sub-sections). Visually verified.

## Validation (P10)
- `node scripts/compile-menu-mapping.mjs --check` → pass.
- menuMapping+config unit tests → 79 pass; config E2E (demoConfig/configVisibility/ui/solo/
  navigationBoundaries/keypadInput/configEditingBehavior) → 37 pass.
- `npm run lint` → PASS (incl. menu-mapping:check + web build).
- `npm test` (full) → see final report.
</content>
