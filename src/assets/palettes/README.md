# VIC-II palettes

VICE `.vpl` palette files. `default.vpl` is the C64 Ultimate default palette — the one the device
itself renders with — so leaving the app on **Default** shows the same colours as the machine. The
others are alternative renderings of the same 16 indices.

## How they are used

The video stream carries **4-bit palette indices**, never colour values, so the palette is purely a
decision this app makes when it paints a frame. Choosing a different one cannot change, improve or
corrupt what the device sent; it changes only how the app draws it.

`scripts/compile-palettes.mjs` parses these files into `src/generated/vicPalettes.ts` at build time,
so nothing is fetched or parsed at runtime. Re-run it (or `npm run palettes:build`) after changing a
`.vpl`; `npm run lint` fails if the generated file has drifted.

Adding one is a single file: drop a `.vpl` in here and rebuild. It needs all 16 colours, and the
build fails if it does not have them.
