# Vendored: `@sidflow/libsidplayfp-wasm`

WASM build of **libsidplayfp** + the `SidAudioEngine` real-time player, used by the
**Local SID playback engine** (spec §12 / Track B). Loaded lazily by
`src/lib/playback/localSid.worker.ts` — only when the user selects the "This device"
playback engine — via a runtime `import("/wasm/libsidplayfp/index.js")`. Vite copies
this directory verbatim (it lives under `public/`), so the emscripten glue is never
parsed by the bundler.

- **Source:** `@sidflow/libsidplayfp-wasm` (own monorepo, `/home/chris/dev/c64/sidflow/packages/libsidplayfp-wasm`).
- **Version:** `0.3.10`
- **Files:** `index.js` (loader), `libsidplayfp.js` (emscripten glue), `libsidplayfp.wasm`
  (391 KiB binary), `player.js` (`SidAudioEngine`), `LICENSE`.

## Licence (spec §12.2, LE0 — PASS)

libsidplayfp is **GPL-2.0-or-later** (see `LICENSE`), compatible with this app's
**GPL-3.0-or-later** licence; the conveyed combined work is GPL-3.0-or-later. reSIDfp
and transitive components are v2-or-later/permissive; no GPL-2.0-**only** component.
Attributed in `THIRD_PARTY_NOTICES.md`. **ROMs are never bundled** — ROM-dependent
tunes are detected and routed to "Play on C64" instead (`setSystemROMs` unused).

## Local edits (kept minimal; re-apply on any re-vendor)

`index.js` only, to work in this flat directory instead of the source's `dist/` layout:

1. `import … from "../dist/libsidplayfp.js"` → `"./libsidplayfp.js"`.
2. `new URL("../dist/", import.meta.url)` → `new URL("./", import.meta.url)` (so the
   `.wasm` resolves as a sibling of `index.js`).
3. Dropped the trailing `//# sourceMappingURL=` comments (`.map` files not vendored).
