# Appearance Styles Specification

## 1. Scope

This document defines the appearance-style model for C64 Commander: a second, curated axis
alongside the existing Light/Dark/System theme.

It is the source of truth for:

- what a style is allowed to change and forbidden from changing
- the source format, compiler and generated artifacts
- the runtime resolution model, including "Match my device"
- the accessibility and geometry-invariance gates a style must pass
- where the full design rationale and the seven styles' individual values live

The design record — why these seven styles, why these names, the naming-clearance search, and the
full compile-time/vitest gate list with numbers — is `docs/plans/appearance-styles/spec.md`. This
document is the day-to-day reference for adding, changing or reviewing a style; it does not repeat
the rationale, only the contract.

## 2. Goals

- Let the palette be changed without changing layout, spacing, typography or any workflow.
- Keep the domain data that already carries meaning (LED colours, VIC palette swatches, the device
  preview's physical materials) provably untouched by a style, at compile time.
- Make every palette pass the same WCAG contrast gates automatically, so a new style cannot ship
  illegible.
- Read the device's own colour-scheme setting once, never poll it, and fail visibly rather than
  silently when it is unknown.

## 3. What a Style May Change

A style is exactly two generated CSS blocks (`html[data-app-style="<id>"]` and
`html[data-app-style="<id>"].dark`) that redeclare a fixed set of custom properties. Nothing else.

The complete emitted set is the fifteen colour tokens each palette declares (`--background`,
`--card`, `--muted`, `--foreground`, `--muted-foreground`, `--primary`, `--primary-foreground`,
`--accent`, `--accent-foreground`, `--border`, `--ring`, `--success`, `--warning`, `--destructive`,
`--destructive-foreground`), plus `--input` (compiled from `--border`), `--radius`, `--edge-width`,
`--ring-style` and, for `vault-black` only, `--app-bar-band`.

The remaining token groups in `src/index.css` — `--secondary`, `--popover`, `--card-foreground`,
and the media/key/category/chart/diag groups — are theme-level, declared once for light and once
for dark, and no style overrides them. A token that a style changes must bring its own paired
foreground with it: leaving `--accent-foreground` theme-level while `--accent` varied per style
put near-white text on a bright accent at 1.2:1 in every dark palette.
`docs/plans/appearance-styles/spec.md` §5.1 has the full table with each token's role.

## 4. What a Style May Never Do

Set or influence: any `margin`, `padding`, `gap`, `width`, `height`, `min-*`, `max-*`, `font-size`,
`font-family`, `font-weight`, `letter-spacing`, `line-height`, `border-width`, `grid-template-*`,
`flex-*`, or a display-profile variable.

The one exception, applied app-wide rather than per style, is `font-variant-numeric: tabular-nums`
on numeric readouts — it cannot change advance width in either direction, so it cannot break §6.

**Edge weight is never `border-width`.** `--edge-width` (1px or 2px) may only ever be rendered as
an inset `box-shadow` or `outline`, through the `shadow-edge` Tailwind utility
(`tailwind.config.ts`, `boxShadow.edge`). A style that changed `border-width` would move a box by
the width delta on every side that has content, which is exactly the geometry §6 forbids. A fixed-
size, empty-content decorative element (for example a reticle corner bracket) is the one case where
literal `border-{t,r,b,l}-2` is still correct: under `box-sizing: border-box`, a border on an
element with no content and a fixed size cannot move anything, so it is not a style edge and must
not be wired to `--edge-width`.

**The focus ring is never derived from `--border`.** On the Callback 8020 the touchscreen is off by
default and the ring is the pointer. `--ring` is declared separately in every palette and gated at
≥3:1 against both the surface behind it and the fill of the control it wraps (WCAG 2.1 SC 1.4.11 /
2.4.11).

### Tokens compiled but not yet consumed

`--edge-width`, `--ring-style` and `--app-bar-band` are validated by the compiler and emitted into
every palette, but no shipped component reads them yet, so the `edge` and `ring_style` values in
`styles/appearance-styles.yaml` and `vault-black`'s `app_bar_band` currently have no effect on
screen. The Phase 2 sweep deliberately left the 2px sites on fixed `shadow-[inset_0_0_0_2px_…]`
values rather than binding them to `--edge-width`, because at that point the styles were not yet
selectable and binding them would have changed those controls' weight under `full-sun`
(`docs/plans/appearance-styles/plan.md`, Phase 2). Wiring the three axes up is follow-up work: it
is a visual change to shipped chrome and needs its own gallery review, so it was not folded into
the change that made styles selectable.

## 5. Source Format and Compiler

`styles/appearance-styles.yaml` → `scripts/compile-styles.mjs` → two generated artifacts:

1. `src/generated/appStyles.ts` — the style list (`APP_STYLES`, `DEFAULT_APP_STYLE_ID`) consumed by
   the picker and the resolution logic.
2. `src/generated/appStyles.css` — one `html[data-app-style="…"]` block per palette, imported by
   `src/main.tsx` as a second CSS import (not a same-file `@import` from `src/index.css`: this repo
   has no `postcss-import` plugin, so an `@import` not first in the file is silently dropped; a
   second JS-level import has no such ordering requirement, and `html[data-app-style="x"]` already
   beats bare `:root` by specificity regardless of import order).

Compile-time invariants (`compile-styles.mjs`, mirrored in `tests/unit/scripts/compileStyles.test.ts`
and `tests/unit/lib/appStyles/{contrast,structural}.test.ts` so a hand-edit of the generated file
cannot slip past a stale build):

- Every style declares every token in §3, per declared mode. A missing token is a hard compile
  error, never a silent `var()` fallback.
- `modes` is `[light, dark]` or a single mode; a declared mode has a colour block and vice versa.
- Every palette passes every contrast gate in §7.
- `--ring` is never equal to `--border`.
- `default_style` exists and is a declared id.
- Style ids are kebab-case and stable.

Run `npm run styles:build` to regenerate, `npm run styles:check` to verify with no writes (this is
the CI gate — see the `styles` job in `.github/workflows/android.yaml`). `--check` fails with
`generated file is out of date: <path>\n  run: <command>` and exits 1; it never writes in check
mode.

## 6. Runtime Model

```
stored style id  +  stored theme (light | dark | system)  +  OS colour scheme
        |                        |                                |
        +------------------------+--------------------------------+
                                 v
                     resolveAppearance(): { styleId, mode }
                                 v
     <html data-app-style="vault-black" class="dark">   ->  generated CSS layer wins
```

`resolveAppearance` (`src/lib/appStyles/resolveAppearance.ts`) is a pure function over a small,
fully enumerable input space — see `tests/unit/lib/appStyles/resolveAppearance.test.ts` for the
complete matrix. Rules:

1. A style that declares both modes resolves `mode` exactly as `useTheme` resolves today.
2. A style that declares one mode clamps `mode` to it regardless of the theme setting. Settings
   disables the Theme row and states why.
3. An unknown stored style id (a removed style, a downgrade) falls back to the compiled
   `default_style` and clears the stored value.
4. The style is applied as `data-app-style` on `<html>`, alongside the existing `.dark`/`.light`
   class. `AppStyleProvider` (`src/components/AppStyleProvider.tsx`) owns this; a `MutationObserver`
   re-asserts a dark-only style's class clamp if anything else changes the class after it, because
   passive effects fire child-before-ancestor and `useTheme`'s own effect does not know about the
   clamp.

Persistence is a new localStorage key beside `c64u_theme` (`useAppStyle`,
`src/hooks/useAppStyle.ts`), not a widening of `useTheme` — this keeps all pre-existing theme tests
unmodified. "Match my device" is stored as its own sentinel
(`MATCH_MY_DEVICE_SENTINEL`, `src/lib/appStyles/matchMyDevice.ts`), not as the style it currently
resolves to, so the choice survives a device change.

## 7. Match My Device

| Device `Color Scheme`                                          | App style                                    |
| ---------------------------------------------------------------- | --------------------------------------------- |
| `Ultimate Black`                                                  | `vault-black`                                 |
| `Commodore Blue`, `Commodore 1`, `Commodore 2`, `Commodore 3`     | `modem-grey`                                  |
| `C128 Style`                                                      | `petrol-teal`                                 |
| unknown / unreachable                                             | the compiled default, and the picker says so  |

The mapping table (`device_scheme_map` in `styles/appearance-styles.yaml`) is data, not code, so a
firmware update that makes the `Commodore N` aliases distinct is a YAML edit.

**Never polls.** The device's `Color Scheme` config item is read with a plain imperative
`getC64API().getConfigItem(...)` call — not TanStack Query, whose own refetch heuristics can act
like implicit polling — triggered only on a disconnected→connected transition
(`useDeviceColorScheme`, `src/hooks/useDeviceColorScheme.ts`) and via Settings' manual "Refresh
connection" action. A disconnected or unrecognised-scheme result renders visibly (`matchedDeviceStyleId === null`) rather than resolving silently to the default.

## 8. Accessibility Gates

Enforced twice — at compile time by `compile-styles.mjs`, and in
`tests/unit/lib/appStyles/contrast.test.ts` over the generated table, so a hand-edit of the
generated file cannot bypass the gate the compiler enforced at build time. All 12 palettes pass all
of these; the full pair list and each minimum's WCAG basis is `spec.md` §9.

The two pairs specific to this feature, not inherited from the pre-existing theme contrast rules:
`ring` / `card` and `ring` / `muted-surface`, both ≥3:1 (SC 1.4.11) — because the ring is the
pointer on a keypad-only device, its contrast is gated as strictly as any other control.

## 9. Geometry Invariance

**Claim: switching style changes zero geometry.** Proved by
`playwright/appearanceGeometryInvariance.spec.ts`: two routes (Home, Settings) x two display
profiles (compact, medium) x all 12 generated palettes, applied in-page with no reload, asserting
exact equality (no tolerance) on every visible `[data-testid]`'s `getBoundingClientRect()`.

This is why every layout, ergonomics, overflow and keypad-navigation spec in the suite runs on the
default style only rather than being multiplied by 12 — each of those specs' header comments points
back to this one. See §4 for why the token contract makes this true by construction: radius and
shadow are paint-only, and the edge is always an inset box-shadow or outline, never `border-width`.

## 10. The Style Gallery

`/dev/styles`, behind the `app_styles_gallery_enabled` developer-only feature flag
(`src/lib/config/feature-flags.yaml`), renders the real shipped components — not copies — across
nine sections (app-bar, cards, buttons, focus-and-selection, inputs, feedback, overlays, navigation,
data), and accepts `?style=`/`?mode=` so a screenshot run can address one palette directly.

`playwright/appStylesGallery.spec.ts` walks all 12 palettes and writes 108 screenshots to
`docs/img/app/styles/`. This is a separate, fixed-size gallery, not a multiplication of the existing
per-page screenshot corpus under `docs/img/app/<page>/` — style coverage lives here instead, exactly
so the corpus does not grow by a factor of 12.

## 11. What Must Stay Untouched by a Style

Domain data that already carries meaning is provably out of scope for the compiler and for the
Phase-2 chrome sweep:

- `src/lib/config/ledColors.ts` and `src/lib/lighting/constants.ts` — values transmitted to the
  Ultimate's own LED strip. Recolouring a swatch that promises "this is what your LED will look
  like" would make it lie.
- The device-preview colours in `LightingStudioDialog` — the breadbin's beige, the keyboard's black,
  the LED fill: physical materials, not UI chrome.
- VIC palette swatches (`PaletteSwatchStrip`, `AvSyncPanel`) and the heat-map ramp.
- The native splash, launcher icon, manifest colours, and the pre-hydration `body` background in
  `index.html` — brand-locked, not style-following, because they render before storage is read.
