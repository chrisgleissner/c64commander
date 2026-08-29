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
- **Floats.** A screenshot that does not fit moves to where it does, instead of
  leaving a third of a page blank.
- **The index.** `makeindex` collates and merges the page numbers. The Paged.js
  index has to lay the book out twice to read page numbers off its own marks.

## Design

The reference is the 1982 *Commodore 64 User's Guide*: a book to settle into.

| | |
| --- | --- |
| Body | TeX Gyre Pagella (Palatino), 11 pt on a 135 mm measure, about 70 characters a line |
| Headings | TeX Gyre Heros (Helvetica), the era's own structural sans |
| Code | TeX Gyre Cursor (Courier) |
| Page | A4, mirrored margins, the inner one narrower because the gutter eats it |
| Colour | One hue per chapter, carried through the opener, the headings, the figure labels and the index letters |

`preamble.tex` holds all of it. The pipeline in `../build-manuals-latex.mjs`
converts the markdown with pandoc, sizes each screenshot from the shape of its
PNG, and marks index terms from the same `INDEX_TERMS` table the shipping
pipeline uses.

## Requirements

`pandoc`, `pdflatex`, `makeindex`, and TeX Live's `tex-gyre`, `memoir`,
`microtype`, `tcolorbox`, `imakeidx`, `eso-pic` and `caption`. Not wired into CI:
this is a spike.

## Known gaps

- The running head on the index pages still reads the last chapter's name.
- Callout boxes (`manualnote`) are defined but the markdown has nothing that maps
  to them yet.
- Nothing checks the LaTeX output against the Paged.js output.
