# Compact profile: where the vertical and horizontal space goes

Measured on the six primary tab routes at the compact profile's reference viewport,
320 x 426 CSS px (a 480x640 panel at DPR 1.5 — the Callback 8020). Every number below
comes from `getBoundingClientRect()` and `getComputedStyle()` on the rendered page,
driven by the existing Playwright harness (`playwright/displayProfileViewports.ts`,
`playwright/uiMocks.ts`, `tests/mocks/mockC64Server`), not from reading stylesheets.

## Method

For every visible element inside `main.page-shell` the audit records the border box,
computed padding, margins, row gap and font metrics. Vertical whitespace is then
attributed to the **deepest element that owns it**: the bands inside an element's border
box that none of its visible children cover, split into leading (above the first child),
between (gaps) and trailing (below the last child). Because each band has exactly one
deepest owner, the numbers add up across the tree instead of double counting nested
padding. SVG internals are excluded; elements whose only children are inline runs report
an artefact and are ignored where noted.

## What the screen is actually spending

Fixed chrome, before any content is drawn:

| band | height | share of 426 px |
|---|---|---|
| app bar (every page except Config) | 49 px | 11.5% |
| app bar (Config — it carries the search field) | 105 px | 24.6% |
| tab bar | 55.1 px | 12.9% |
| page-shell padding, top + bottom | 16 px | 3.8% |

That leaves a **324 px scroll box on five pages and 268 px on Config**. For reference, the
handset's own UI spends 12.4% of the panel on its status bar and soft-key legend.

Page content, as it loads (all sections in their default state):

| page | content height | measured whitespace | share |
|---|---|---|---|
| Settings | 12295 px | 4933 px | 40% |
| Home | 2352 px | 1844 px | 78% |
| Play | 1448 px | 973 px | 67% |
| Config | 1338 px | 1514 px | * |
| Disks | 893 px | 602 px | 67% |
| Docs | 590 px | 566 px | * |

\* over 100% where absolutely positioned or overlapping children make a band countable
twice. The share is indicative; the ranked owners below and the page heights are exact.

## Ranked offenders (all six pages, as loaded)

`lead`/`between`/`trail` are the three bands described above, in CSS px, summed over
every instance.

| # | px | inst | lead | between | trail | owner | verdict |
|---|---|---|---|---|---|---|---|
| 1 | 642 | 18 | 234 | 192 | 216 | `div.space-y-3.px-3.py-3` — `CollapsibleSection` open body | **fix** — 12 px block padding and 12 px child gaps on a 324 px scroll box |
| 2 | 606 | 44 | 68 | 538 | 0 | `div.space-y-2` | already right — 8 px is the target rhythm |
| 3 | 580 | 6 | 0 | 348 | 232 | `div.gap-3` (page-level stacks, incl. Config's `PageStack`) | **fix** — opts out of `--display-profile-section-gap` (8 px) |
| 4 | 528 | 9 | 0 | 528 | 0 | `div.space-y-3` | **fix** — 12 px between blocks inside cards |
| 5 | 360 | 18 | 0 | 0 | 360 | `label.min-h-11.gap-3` (Settings toggles) | **keep** — 24 px of content in a 44 px box *is* the touch floor |
| 6 | 240 | 1 | 0 | 240 | 0 | `div.grid.gap-4.grid-cols-1` (Settings, 16 rows) | **fix** — 16 px between single-column rows |
| 7 | 236 | 5 | 0 | 13 | 223 | `p.text-xs.text-muted-foreground` | measurement artefact — inline children, not real whitespace |
| 8 | 188 | 5 | 69 | 54 | 65 | `div.space-y-2.p-3` (Settings sub-panels) | **fix** — the `p-3` half |
| 9 | 176 | 3 | 0 | 176 | 0 | `div.page-stack` | already right — 8 px, the halved compact `sectionGap` |
| 10 | 162 | 5 | 66 | 30 | 66 | `button.quick-action.p-2.5.min-h-[86px]` | **leave** — see "deliberately not changed" |
| 11 | 160 | 14 | 0 | 160 | 0 | `div.gap-2` | already right — 8 px |
| 12 | 160 | 3 | 0 | 160 | 0 | `div.space-y-4` (Settings) | **fix** — 16 px |
| 13 | 152 | 1 | 24 | 128 | 0 | `main.page-shell.py-6.space-y-4` (Docs) | **fix** — the one page that overrides the profile's own page padding |
| 14 | 140 | 5 | 70 | 0 | 70 | `label.min-h-11.gap-1` (Play) | **keep** — touch floor |
| 15 | 132 | 2 | 26 | 80 | 26 | `div.p-3.space-y-4` (Settings) | **fix** |
| 16 | 130 | 5 | 65 | 0 | 65 | `div.gap-3.p-3` (Settings) | **fix** |
| 17 | 112 | 5 | 56 | 0 | 56 | `label.min-h-11.gap-2` | **keep** — touch floor |
| 18 | 108 | 9 | 54 | 0 | 54 | `div.p-1.5` (quick-action icon tile) | **keep** — inside the 86 px tile, not additive |
| 19 | 98 | 1 | 17 | 64 | 17 | `[play-section-playback].p-4.space-y-4` | **fix** — 16 px padding and 16 px gaps on the Play page's main card |
| 20 | 68 | 2 | 34 | 0 | 34 | `div.p-4.space-y-4` (Disks, Play playlist panel) | **fix** |

Section header rows and every control were measured separately and are **already
correct**: the `CollapsibleSection` toggle is exactly 44.0 px, the chevron 44x44, a tab
item 44.1 px, and the Settings/Play checkbox rows 44 px. Their apparent "waste" is the
44 px touch floor doing its job around 21.6 px of text. Nothing in that group was touched.

## Diagnosis

The app has one type ramp per display profile (`src/index.css`, "The phone profile's own
type scale") because almost every size in the codebase is written as `text-xs` or
`text-sm`. Spacing has exactly the same shape — a handful of utilities carry nearly all of
it — and never got the same treatment. The values were picked against a 393 px phone with
about 640 px of scrollable height, and the compact profile reuses them unchanged on a
screen with half the height. Eight utilities (`p-4`, `p-3`, `py-4`, `py-3`, `space-y-4`,
`space-y-3`, `gap-4`, `gap-3`) account for most of rows 1, 3, 4, 6, 8, 12, 13, 15, 16, 19
and 20 above.

Three surfaces additionally opt out of the profile token system altogether: Config's
`PageStack className="gap-3"`, Docs' `PageContainer className="py-6 space-y-4"`, and the
app bar's fixed `space-y-3` between the title row and a page's own header row.

Horizontally, the picture is much healthier. A card's text starts 21 px from the screen
edge (8 px page padding + 1 px border + 12 px card padding), which is 13% of 320 px for
both margins together. The only real outlier is the `p-4` card at 16 px, and `px-*` on
controls is part of how large they are to hit, so it is left alone.

## Changes made

All conditional on the compact profile. No control was added, removed, renamed, reordered
or re-gated; no font size and no control height changed.

1. **A compact spacing ramp in `src/index.css`**, the counterpart to the existing compact
   type ramp, scoped to `.page-shell` (page content only — chrome, dialogs and sheets
   render outside it). `p-4`, `p-3`, `py-4`, `py-3`, `space-y-4`, `space-y-3` and the
   *row* gap of `gap-4`/`gap-3` all land on a single 8 px vertical rhythm; `p-4`'s
   horizontal half drops from 16 px to the 12 px every other card already uses. Column
   gaps and `px-*` are untouched, so horizontal separation between side-by-side controls
   is exactly as before.
2. **`.tab-bar` bottom padding** (8 px against 2 px at the top) reduced to the rail
   padding on compact, with `--app-tab-bar-visual-height` lowered from `3rem` to
   `2.8125rem` so the frame reservation follows the bar down instead of leaving the dead
   band behind.
3. **`ConfigBrowserPage`**: `PageStack className="gap-3"` becomes non-compact only, so the
   compact profile uses `--display-profile-section-gap`. Same shape as `HomePage`'s
   existing `gap-4` override.
4. **`DocsPage`**: `PageContainer className="py-6 space-y-4"` becomes `space-y-2` on
   compact, so `.page-shell`'s own profile padding applies and the cards stack on the same
   8 px rhythm as every other page.
5. **`AppBar`**: the gap between the title row and a page's own header row goes from 12 px
   to 8 px on compact.

### Measured result at 320x426

| page | content height before → after | saved | controls fully on the first screen |
|---|---|---|---|
| Settings | 12295 → 11511 px | −784 (−6.4%) | 9 → 9 |
| Play | 1448 → 1328 px | −120 (−8.3%) | 5 → 5 |
| Docs | 590 → 494 px | −96 (−16.3%) | 10 → 12 |
| Config | 1338 → 1250 px | −88 (−6.6%) | 8 → 10 |
| Disks | 893 → 817 px | −76 (−8.5%) | 6 → 8 |
| Home | 2352 → 2304 px | −48 (−2.0%) | 7 → 7 |

With one section opened, Home goes from 10 to 13 controls on the first screen and Docs
from 4 to 6.

Visible scroll box: **324 → 327 px** on five pages and **268 → 275 px** on Config, on
every screen of every page, from the chrome changes. The tab bar itself is 55.1 → 49.1 px.

## Deliberately not changed

- **Every 44 px control.** Section headers, chevrons, tab items, checkbox rows, buttons
  and inputs all sit exactly on the floor already. Rows 5, 14 and 17 of the table above
  look like waste and are not.
- **`space-y-2`, `gap-2`, `p-2` and anything already at 8 px.** They are the target.
- **Column gaps and `px-*`.** Vertical space is the scarce axis here; horizontal padding
  on a control is part of its target size.
- **The 86 px quick-action tile** (row 10). Its content is 59.6 px, so about 6 px per tile
  is slack — roughly 30 px over Home's five rows of tiles. It is a large, deliberate
  primary target that the keypad focus ring also draws around, and cutting it is a taste
  call rather than a clear win. **Left for a human.**
- **Dialogs, sheets and the Remote Input surface.** They render outside `.page-shell` and
  were not measured here. They are the obvious next place to look.
- **Medium and expanded.** Every change is inside a compact-profile selector or a
  `profile === "compact"` branch.

## Known unrelated failure

`playwright/layoutOverflow.spec.ts` › "viewport matrix preserves layout and scrolling"
fails on this machine at the 844x390 landscape viewport, where the Play "View all" dialog
is drawn outside the viewport. It fails identically on the unmodified base commit
(verified by reverting `src/` completely, rebuilding and re-running the single test), so
it is not caused by anything here. All 126 other tests in the layout, ergonomics,
display-profile, callback-small-screen, compact-text-sweep, connection-status and
modal-consistency specs pass.
