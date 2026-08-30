# The manual's print pipeline

The manual is written once and comes out twice: as Markdown, and as a typeset
PDF. `scripts/build-manuals.mjs` renders the prose to Markdown, one file per
edition. `scripts/build-manuals-latex.mjs` hands that Markdown to LuaLaTeX and
produces the print edition.

```bash
./build --manual        # installs the toolchain if needed, then builds both
./build --manual-deps   # just the toolchain
```

Output lands in `docs/manual/<variant>/` (Markdown, tracked) and
`docs/manual/latex/<variant>/` (PDF, gitignored).

## Requirements

`scripts/latex/install-deps.sh` holds the list and installs it on Ubuntu or
Debian. Five TeX Live packages and pandoc, about 380 MB:

|                             |                                                                           |
| --------------------------- | ------------------------------------------------------------------------- |
| `texlive-latex-base`        | lualatex, graphicx, longtable, array, colortbl, hyperref                  |
| `texlive-latex-recommended` | memoir, microtype, xcolor, caption, booktabs, eso-pic, fontspec, ragged2e |
| `texlive-latex-extra`       | tcolorbox, imakeidx, enumitem                                             |
| `texlive-luatex`            | luaotfload, without which lualatex cannot load an OpenType face           |
| `texlive-binaries`          | makeindex                                                                 |
| `pandoc`                    | Markdown to LaTeX                                                         |

Not `texlive-full`. That is about 6 GB, and none of it is needed: the typefaces
are vendored under `fonts/`, so no TeX font package is involved.

The same script runs in CI, which is the point. One list means a green CI run
says something about whether the book builds on a contributor's machine.

## Design

The reference is the C64's own 1982 user's guide: a book to settle into.

|          |                                                                                                                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Body     | IBM Plex Serif                                                                                                                                                                            |
| Headings | IBM Plex Sans                                                                                                                                                                             |
| Code     | IBM Plex Mono                                                                                                                                                                             |
| Page     | A4, mirrored margins, 135 mm measure, about 70 characters a line                                                                                                                          |
| Colour   | One hue per chapter, carried through the opener, the thumb tab, the running head, the section numbers, the bullets, the figure labels, the callouts, the table head and the index letters |

IBM Plex is the family the app itself uses, so the printed page and the screen
are one design. The faces are vendored rather than installed, and loaded by path
rather than by name: a font installed on the machine can be absent or a
different version on someone else's, and loading by name needs a fontconfig
database that a minimal TeX Live does not have.

### Three decisions worth knowing about

**A figure never floats.** In a step-by-step guide the screenshot _is_ the
sentence above it. Floats were tried with `[!ht]`, a `\FloatBarrier` at every
section and subsection, `totalnumber` capped and the placement fractions opened
up; pictures still drifted, because four screenshots inside one section cannot
all fit beside their own text. Figures are set exactly where they were written,
inside an unbreakable `minipage` so a page breaks before one rather than through
it. The price is white space at the foot of the occasional page.

**Callouts come from the prose, not from new text.** Three sources: the
`_Availability: ..._` line that closes a feature section, but only where it says
the feature is off to begin with; the `Preferred path:` line that closes a flow,
but only where it carries more than a restatement of the steps above it; and any
Markdown blockquote. `> **Tip.** ...` and `> **Take care.** ...` are the
convention, and the bold lead becomes the box label.

**There is no second engine.** A pdfLaTeX path used to fall back to the TeX Gyre
revivals when IBM Plex could not be loaded. It was removed: a silent fallback to
another typeface is worse than a build that stops, because the manual still came
out looking like a different book and nothing in the file said so.

## Known gaps

- The running head on the index pages carries the last chapter's name.
- The thumb tabs assume nine chapters. A tenth would reuse the first hue and run
  off the foot of the tab column.
