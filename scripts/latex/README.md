# LaTeX manual spike

An alternative print pipeline for the same manual. The prose comes from
`renderManualMarkdown` in `../build-manuals.mjs`, unchanged, so this and the
shipping Paged.js pipeline always describe the same app.

```bash
node scripts/build-manuals-latex.mjs
# docs/manual/latex/<variant>/<variant>-manual.pdf
```

## Why

The shipping PDF is laid out by Paged.js inside a headless Chromium: a good
browser doing its best at typesetting. This is a typesetter. Four things change:

- **Justification.** TeX breaks a paragraph as a whole rather than a line at a
  time, and hyphenates. At the 135 mm measure the manual is set to, that is the
  difference between an even grey text block and one with rivers in it.
- **microtype.** Margin kerning and small optical adjustments to letter and word
  spacing, which no browser does.
- **The index.** `makeindex` collates and merges the page numbers. The Paged.js
  index has to lay the book out twice to read page numbers off its own marks.
- **A thumb index.** Chapter tabs down the outer edge, which needs a shipout
  hook and a page-parity test.

## Design

The reference is the C64's own 1982 user's guide: a book to settle into.

|          |                                                                                                                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Body     | IBM Plex Serif under LuaLaTeX, TeX Gyre Pagella under pdfLaTeX                                                                                                                            |
| Headings | IBM Plex Sans, or TeX Gyre Heros                                                                                                                                                          |
| Code     | IBM Plex Mono, or TeX Gyre Cursor                                                                                                                                                         |
| Page     | A4, mirrored margins, 135 mm measure, about 70 characters a line                                                                                                                          |
| Colour   | One hue per chapter, carried through the opener, the thumb tab, the running head, the section numbers, the bullets, the figure labels, the callouts, the table head and the index letters |

### Two decisions worth knowing about

**A figure never floats.** In a step-by-step guide the screenshot _is_ the
sentence above it. Floats were tried with `[!ht]`, a `\FloatBarrier` at every
section and subsection, `totalnumber` capped and the placement fractions opened
up; pictures still drifted, because four screenshots inside one section cannot
all fit beside their own text. Figures are now set exactly where they were
written, inside an unbreakable `minipage` so a page breaks before one rather
than through it. The price is white space at the foot of the occasional page.

**Callouts come from the prose, not from new text.** Three sources: the
`_Availability: ..._` line that closes a feature section, the `Preferred path:`
line that closes a flow, and any markdown blockquote. `> **Tip.** ...` and
`> **Take care.** ...` are the convention; the bold lead becomes the box label.

## Requirements

`pandoc`, `makeindex`, and either `lualatex` with `luaotfload` and the IBM Plex
TTFs in `/usr/share/fonts/truetype/ibm-plex/`, or `pdflatex` with `tex-gyre`.
Plus TeX Live's `memoir`, `microtype`, `tcolorbox`, `imakeidx`, `eso-pic`,
`caption`, `colortbl` and `etoolbox`. `texlive-full` covers all of it.

The engine is chosen at build time: `luaTexUsable()` probes for `luaotfload`,
because a TeX Live without it still ships the `lualatex` binary and that binary
starts fine and then dies at the first `\setmainfont`.

## Known gaps

- The running head on the index pages carries the last chapter's name.
- Nothing checks the LaTeX output against the Paged.js output, and nothing runs
  this in CI.
- The thumb tabs assume nine chapters. A tenth would reuse the first hue and
  run off the foot of the tab column.
