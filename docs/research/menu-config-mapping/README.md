# Menu ⇄ Config mapping layer

A **display/projection layer** that presents device configuration using the familiar
device-menu **terminology** (and, for C64U, the captured menu **hierarchy**) while keeping
the REST API the internal source of truth. It relabels and regroups *live* `GET /v1/configs`
data — it never adds, removes, or hides an item.

## Two invariants

1. **Lossless / no static gating.** The Config page renders **every** item live
   `GET /v1/configs` returns, on every device (C64U, U64, U2, unknown/future). No
   allow-list, denylist, `ProductFamilyCode` literal, or category roster decides what
   shows — that follows live REST only. The firmware builds its category set dynamically
   from the subsystems compiled into each device, so no static source can predict it.
2. **C64U terminology is a source, not a gate.** C64U menu labels are reused wherever any
   device exposes the same REST `{category,item}`, but no item must be "known to the menu"
   to render.

## Two independently-applied layers

| Layer | Keyed by | Source | Applies on |
|---|---|---|---|
| **A. Terminology overlay** — `{label, formatterId}` per item | REST `{category,item}` | C64U menu YAML | **Every** device (both layouts) |
| **B. Menu hierarchy** — menu page/section grouping + aliases | `family + firmwareVersion` | A captured menu YAML (only **C64U 1.1.0** today) | Only when a menu resolves; else REST-grouped layout |

- **Layer A always runs.** `TERMINOLOGY_OVERLAY` (`overlay.ts`) is a device-agnostic
  `{category → {item → {label, formatterId}}}` index. For any live item: friendly label if
  present, else the acronym-preserving `humanizeRestName` (fallback area only).
- **Layer B runs only when `resolveMenuMapping(family, firmwareVersion)` returns a
  hierarchy.** `null` (U64 / U2 / unknown / unmapped firmware) ⇒ the page renders the live
  REST-category grouping — with Layer A still relabeling within it.

### Degradation ladder (holds for every device)
1. C64U on a resolving firmware → menu hierarchy (Layer B) + friendly labels (Layer A) +
   Advanced (REST-only) fallback for anything the hierarchy didn't claim.
2. C64U on a firmware with no exact menu → nearest-version C64U menu; new/unknown items
   auto-route to the fallback.
3. U64 / U2 / unknown family → no Layer B; REST-category grouping; Layer A labels where
   shared; everything reachable by definition.

## Pipeline (mirrors the feature-flags convention)

```
docs/c64/devices/c64u/1.1.0/c64u-menu.yaml          # hierarchy + labels + node kinds (captured)
src/lib/config/menuMapping/c64u-1.1.0.association.yaml   # REST pointers + formatter/alias flags (authored)
        │  scripts/compile-menu-mapping.mjs   (validates vs c64u-config.yaml; npm run menu-mapping:check in lint)
        ▼
src/lib/config/menuMapping/c64u-1.1.0.generated.ts  # COMMITTED: C64U_1_1_0_HIERARCHY (B) + C64U_1_1_0_OVERLAY (A)
        │
        ├─ resolveMenuMapping({family,firmwareVersion}) → hierarchy | null   (Layer B selector)
        ├─ TERMINOLOGY_OVERLAY                                                (Layer A, device-agnostic)
        └─ projectConfigToMenu(liveRest, {hierarchy, overlay}) → {tree, drift, renderedRest}   (pure, lossless)
                    │
                    ▼  ConfigBrowserPage.tsx → MenuPageSection / MenuBlock / FallbackCategoryBlock / CategorySection
```

`projectConfigToMenu` is the pure, node-tested spec. The page renders the same shape
lazily: each menu page fetches its REST categories on expand.

## Smart dissolution of the Advanced fallback (`advancedRouting.ts`)

A raw "everything `live − claimed`" Advanced section reads as a junk drawer. Instead,
each unclaimed item is **smart-routed** to its most-aligned menu page (rendered there
under an "Advanced" sub-header), via three tiers — most-specific first, deliberately
small (not a rule engine):

1. **Keyword rules** (per family, category-scoped) — split the one multi-owner category
   (`U64 Specific Settings`) by topic: HDMI/scan/colour → Video setup, user-port →
   Joystick & controllers, serial/parallel/burst → Built-in drive A.
2. **Sole-owner derivation** (data-driven from the hierarchy) — a category claimed by
   exactly one menu page sends its leftovers to that page. Covers 16 of 17 C64U
   categories with zero hand-authoring and stays correct as the menu evolves.
3. **Category defaults** (per family) — a home for categories no page claims
   (`SoftIEC Drive Settings`, `Tape Settings` → Built-in drive A; `Data Streams` →
   Network services & timezone).

Anything still homeless (`routeAdvancedItem` → `null`: an unknown/future category with no
owner, keyword, or default) falls to the **residual Advanced section**, which
`ConfigBrowserPage` **omits entirely when empty** (computed cheaply from the live category
list via `unroutedCategories` — no per-item fetch). On C64U 1.1.0/3.14 every leftover has
a home, so the junk drawer disappears; an unknown category still surfaces (lossless).

## Key files

- `src/lib/config/menuMapping/` — `types.ts`, `menuValueFormatters.ts`, `humanize.ts`,
  `overlay.ts`, `resolveMenuMapping.ts`, `projectConfigToMenu.ts`, `index.ts`,
  `c64u-1.1.0.association.yaml` (source), `c64u-1.1.0.generated.ts` (committed, generated).
- `scripts/compile-menu-mapping.mjs` — compiler + drift checker (`--check`).
- `src/pages/config/` — `MenuPageSection`, `MenuBlock`, `FallbackCategoryBlock`,
  `AdvancedFallbackSection`, `ConfigLeafRow`, `useConfigLeafWrite`, `menuBlocks`.
- `src/pages/ConfigBrowserPage.tsx` — branches on `resolveMenuMapping`.

## How to add a U64 / U2 / future-firmware menu

**Shared items already get Layer A labels with zero new work**, so adding a family is
purely additive (it only adds a hierarchy + family-specific labels):

1. Capture the device's menu as `docs/c64/devices/<family>/<ver>/<family>-menu.yaml`
   (hierarchy + labels + node kinds). Do **not** fabricate one — without a real capture,
   that family keeps the REST-grouped layout (+ Layer A).
2. Bootstrap the association with the authoring aid:
   `python3 scripts/menu-mapping/draft_association.py` (retarget its RULES block), review
   the report, resolve UNMATCHED leaves, then `--emit`. See
   `.github/skills/menu-mapping-authoring/SKILL.md`.
3. Add the target to `TARGETS` in `scripts/compile-menu-mapping.mjs`, register it in the
   `REGISTRY` of `resolveMenuMapping.ts`, run `npm run menu-mapping:compile`.
4. Validate: `npm run menu-mapping:check` (in `npm run lint`), `npm run typecheck`, tests.

## Canonical-identity invariants (do not break)

- **REST `{category,item}` stays canonical** for control-type inference, the per-item
  detail fetch, and write-back (PUT for single writes). The projection never mutates it.
- **The page always renders the full live `GET /v1/configs` with no static gating.** The
  compile `intentionallyUnmapped` list is a *dev-time authoring nudge only* — it is never
  consulted at runtime; the runtime fallback is `live − claimed`, computed from live data.
- Aliases (e.g. drive ROMs under both "Built-in drive A" and "Memory & ROMs") point at the
  **same** REST pointer and share one optimistic cell (`canonicalConfigKey`).
