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
  (binary), `player.js` (`SidAudioEngine`), `LICENSE`.

### Pinned upstream (recorded here because the package is vendored, not on npm)

| component      | ref                                                                          |
| -------------- | ---------------------------------------------------------------------------- |
| `libsidplayfp` | **v3.0.2** (stable; previously the v3.0.0a2 pre-release alpha)               |
| `libresidfp`   | **v1.1.2** — the reSIDfp engine, an external library since libsidplayfp v3.x |

Override at build time with `LIBSIDPLAYFP_REF` / `LIBRESIDFP_REF`.

The engine is **reSIDfp**, asserted at build time (`WasmReSIDfp` present, `WasmSIDLite` absent) plus a
functional smoke render. Earlier artifacts silently fell back to SIDLite — a lightweight
cRSID-derived approximation — because `HAVE_RESIDFP` was never defined; see
`docs/plans/sid-station/AUDIO-FIDELITY-TEST.md` §6 for what that cost and how it was measured. This
artifact is indistinguishable from a native build of the same library: correlation > 0.99999 with an
error floor around −80 dBFS (not bit-exact — emscripten's libm differs from glibc's in the last ulp,
which reaches the reSIDfp table generation).

## Licence (spec §12.2, LE0 — PASS)

libsidplayfp is **GPL-2.0-or-later** (see `LICENSE`), compatible with this app's
**GPL-3.0-or-later** licence; the conveyed combined work is GPL-3.0-or-later. `libresidfp`
(vendored into the binary since v3.x split reSIDfp out) is likewise **GPL-2.0-or-later**, and
transitive components are v2-or-later/permissive; no GPL-2.0-**only** component.
Attributed in `THIRD_PARTY_NOTICES.md`. **ROMs are never bundled.**

> **ROMs are a prerequisite, not an accuracy upgrade.** Measured in `AUDIO-FIDELITY-TEST.md` §6.2:
> without KERNAL/BASIC the engine initialises a tune and then never advances it — a flat drone
> (per-second RMS constant to four decimals), envelope correlation ~0.008. With ROMs it reaches 1.000
> against native and 0.625 against real hardware. Today the app still detects RSID and routes it to
> "Play on C64" with `setSystemROMs` unused, which means **PSID on-device playback is also affected**.
> Wiring ROMs in (handover §1.7 — read from the connected Ultimate over DMA, kept on the user's own
> phone, never bundled or exported) is therefore a correctness prerequisite for offering the Local
> engine at all, not just an RSID unlock.

## Local edits (kept minimal; re-apply on any re-vendor)

`index.js` only, to work in this flat directory instead of the source's `dist/` layout:

1. `import … from "../dist/libsidplayfp.js"` → `"./libsidplayfp.js"`.
2. `new URL("../dist/", import.meta.url)` → `new URL("./", import.meta.url)` (so the
   `.wasm` resolves as a sibling of `index.js`).
3. Dropped the trailing `//# sourceMappingURL=` comments (`.map` files not vendored).

## Migration in progress: fetched at build time, not committed

The binaries in this directory are currently **committed**, which is how the engine silently shipped
as SIDLite for months: a committed blob carries no version, no provenance and no integrity check, and
every engine change adds ~425 KB to this repo's history forever.

sidflow now attaches `libsidplayfp-wasm-<tag>.tar.gz` plus `SHA256SUMS` to every release (reSIDfp in
the root, SIDLite under `sidlite/`), and `scripts/fetch-libsidplayfp-wasm.mjs` is wired into
`prebuild` to fetch and verify it — the same shape as `fetch-sidcorr.mjs` fetches the similarity
corpus. It runs at **build time**, before `vite build` and therefore before Capacitor copies `dist/`
into the native bundle, so the engine ships **inside** the APK / IPA / Docker image. The app never
downloads anything at runtime.

The pin (`LIBSIDPLAYFP_WASM_RELEASE.tag`) is deliberately `null` until sidflow publishes a release
carrying the asset — the workflow landed in sidflow `8b2617d`, after the current `0.6.0` release.
While it is null the fetch is a no-op and these committed files are used.

**To complete the switch**, once such a release exists:

1. set `tag` in `scripts/fetch-libsidplayfp-wasm.mjs`;
2. run `npm run wasm:fetch` and copy the printed `SHA256SUMS` digest into `checksumsSha256`;
3. `git rm` the binaries here (`index.js` excepted — see the local edits above) and add
   `public/wasm/libsidplayfp/*.wasm` / `*.js` to `.gitignore`, mirroring `public/data/sidcorr/`;
4. re-run `npm run build` and confirm the engine still lands in `dist/wasm/libsidplayfp/`.

The unit test `tests/unit/scripts/fetchLibsidplayfpWasm.test.ts` already enforces that a pinned tag
must come with a checksum, and that the shipped files come from the reSIDfp root rather than
`sidlite/`.
