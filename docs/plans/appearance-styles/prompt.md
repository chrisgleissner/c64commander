# Appearance Styles — Implementation Kickoff

Paste this to the agent that will implement the feature.

---

You are implementing the **Appearance Styles** feature in `/home/chris/dev/c64/c64commander`.

## Names and ids were revised on 2026-08-27 — re-read `spec.md` if you saw an earlier copy

Three style names changed after a trademark register search, and the **ids changed with them**:

| was | now |
|---|---|
| `Candy Shell` / `candy-shell` | **`Neon Pop`** / `neon-pop` |
| `Signal` / `signal` | **`Full Sun`** / `full-sun` |

`Breadbin Beige` was reviewed and kept. The other four are unchanged. Ids are the persisted setting
value, so these are final — do not reintroduce the old ones.

## Read first, in this order

1. `docs/plans/appearance-styles/spec.md` — the design. Sections 4 (locked decisions), 5 (the token
   contract), 9 (the contrast gates) and 10 (the layout-invariance guarantee) are binding.
   Appendix A holds every palette value; copy it, do not re-derive it.
2. `docs/plans/appearance-styles/plan.md` — the sequence, phase 0 through 8, with file:line
   references for every site that needs to change.
3. `docs/plans/appearance-styles/research.md` — why the palettes look the way they do.
4. `docs/architecture.md`, `docs/ux-guidelines.md`, `docs/ux-interactions.md`,
   `docs/internals/display-profiles.md`.

## What you are building

A second appearance axis alongside Light / Dark / System: seven curated **styles**, each a palette
plus a surface treatment. Five have a light and a dark rendition, two are dark-only — twelve
palettes in total. Styles are defined in YAML and compiled; users select one, they cannot author
one.

## The five rules that must not be broken

1. **No geometry.** A style may set colour, corner radius, edge treatment, elevation and the
   focus-ring treatment. It may never set spacing, sizing, type or `border-width`. Render every
   edge as `box-shadow: inset` or `outline`, never `border-width` — an intrinsically-sized button
   grows by 2 px otherwise, and that makes the invariance proof impossible.
2. **The focus ring is a first-class token.** `--ring` is declared per palette, is never equal to
   `--border`, and is gated at ≥ 3:1 against both the surface behind it and the fill of the control
   it wraps. On the target device the touchscreen is off and this ring is the pointer.
3. **Every palette passes every gate in spec §9**, enforced at compile time *and* in a vitest test
   over the generated table.
4. **Domain data is not chrome.** LED colours, VIC palette swatches, the device-preview materials
   in Lighting Studio and the heat-map ramp must be byte-identical when you are done. Plan phase 2
   lists all 21 sites. Recolouring a swatch that promises "this is what your LED will look like"
   makes it lie.
5. **Do not multiply the screenshot corpus.** 273 tracked PNGs × 12 would be 3,276 files and about
   580 MB, and the existing pixel-dedupe would never fire because every pixel changes. Style
   coverage comes from the fixed gallery in spec §11.

## Start here

Phase 0 in `plan.md` — five repairs that block everything else. Two of them are live bugs found
during the design work, both independently worth fixing:

- `src/components/ui/sonner.tsx:15` reads `useTheme()` from `next-themes`, whose provider is never
  mounted. Toast theming currently follows the OS, not the app.
- `src/lib/disks/diskGroupColors.ts:10-13` uses `text-*-700` with no dark variant, so disk-group
  chips are illegible in dark mode today.

Then write the **geometry-invariance test from spec §10 before phase 2's radius sweep**, so the
sweep is checked by it rather than the other way round.

## Landing it

- Phases 0-2 are a self-contained pull request: a strict improvement, no user-visible change beyond
  those two bug fixes, and it makes the phase-3 diff readable.
- Phase 3 is inert until phase 4 wires it up, so it can land alone too.
- Phases 4-6 are the user-visible change and land together.

## Gates before every push

Run the `ship-gates` skill. It encodes two traps that have each turned a green pull request red:
a bare `tsc --noEmit` is not the typecheck CI runs, and a local build rewrites three files that
must never be committed.

Note that `npm run lint` — where `palettes:check` and `variant:check` live — **is not run by any
GitHub workflow**. Phase 3 requires adding a CI drift job modelled on the existing
`Notices | Generation + drift` job in `.github/workflows/android.yaml:90-136`, or `styles:check`
will only ever fail on developer machines.

## When you are unsure

The spec's §4 decisions were made deliberately with the product owner and are not yours to revisit.
If implementation reveals one of them is unworkable, stop and say so with the specific evidence —
do not quietly pick a different design. In particular, if the geometry-invariance test goes red,
find the token that moved a box. Do not add a tolerance; a tolerance makes that test worthless.

## Done means

The seven checks in `plan.md` under "Definition of done", all satisfied and demonstrated — not
asserted.
