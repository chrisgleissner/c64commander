# VIC-II palettes

VICE `.vpl` palette files, copied verbatim from the sibling project
[c64stream](https://github.com/chrisgleissner/c64stream) at `data/palettes/`.

`default.vpl` is the C64 Ultimate default palette — the one the device itself renders with — so
leaving the app on **Default** shows the same colours as the machine and as c64stream. The others are
alternative renderings of the same 16 indices.

## How they are used

The video stream carries **4-bit palette indices**, never colour values, so the palette is purely a
decision this app makes when it paints a frame. Choosing a different one cannot change, improve or
corrupt what the device sent; it changes only how the app draws it.

`scripts/compile-palettes.mjs` parses these files into `src/generated/vicPalettes.ts` at build time,
so nothing is fetched or parsed at runtime. Re-run it (or `npm run palettes:build`) after changing a
`.vpl`; `npm run lint` fails if the generated file has drifted.

## Provenance and licence

c64stream is published under **GPL v2**; this app is **GPL-3.0-or-later**. Both are works of the same
author, who bundled these files here deliberately. If these palettes are ever taken from a third
party, check the licence before adding them.
