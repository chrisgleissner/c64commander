# libsidplayfp WASM engine — pinned, fetched, verified

WASM build of **libsidplayfp** plus the `SidAudioEngine` real-time player, used by the
**Local SID playback engine** (spec §12 / Track B). Loaded lazily by
`src/lib/playback/localSid.worker.ts` — only when the user picks the "This device"
playback engine — via a runtime `import("/wasm/libsidplayfp/index.js")`. This directory
lives under `public/`, which Vite copies verbatim, so the emscripten glue is never
parsed by the bundler.

## What is committed, and what is not

| File                                | Origin                                                             |
| ----------------------------------- | ------------------------------------------------------------------ |
| `index.js`, `player.js`             | **this repo** — our loader and `SidAudioEngine` wrapper             |
| `README.md`, `VENDORING.md`         | **this repo** — upstream's usage notes, and this file               |
| `libsidplayfp.{js,wasm}`, `LICENSE` | **fetched** — reSIDfp, from the release root                        |
| `sidlite/libsidplayfp.{js,wasm}`    | **fetched** — SIDLite, from the release's `sidlite/`                |

The fetched files are **git-ignored**. `scripts/fetch-libsidplayfp-wasm.mjs` downloads
`libsidplayfp-wasm-<tag>.tar.gz` from the pinned `chrisgleissner/sidflow` release and
verifies every file against that release's own `SHA256SUMS`, whose digest is itself
pinned in the script. A mismatch is a hard build failure.

It runs at **build time**, from `prebuild` — before `vite build`, and therefore before
Capacitor copies `dist/` into the native bundle. The engine ships **inside** the APK /
IPA / Docker image; the app downloads nothing at runtime.

### Why not just commit the binaries?

They were committed, and it cost months of wrong sound: the artifact was silently
**SIDLite** rather than reSIDfp and nothing could tell, because a committed blob carries
no version, no provenance and no integrity check. (See
`docs/plans/sid-station/AUDIO-FIDELITY-TEST.md` §6.) Committing also added ~425 KB to
this repository's history on every engine change, permanently.

## The pin

| component      | ref                                                                         |
| -------------- | --------------------------------------------------------------------------- |
| release        | **`chrisgleissner/sidflow` 0.7.0**                                          |
| `libsidplayfp` | **v3.0.2** (stable; previously the v3.0.0a2 pre-release alpha)              |
| `libresidfp`   | **v1.1.2** — the reSIDfp engine, an external library since libsidplayfp v3.x |

To move the pin: set `tag` in `scripts/fetch-libsidplayfp-wasm.mjs`, run
`npm run wasm:fetch`, copy the printed `SHA256SUMS` digest into `checksumsSha256`, and
re-run. Then run the unit tests — `tests/unit/scripts/libsidplayfpArtifact.test.ts`
loads each fetched binary and asserts it reports its own engine name and still answers
the calls `localSid.worker.ts` makes, which a checksum cannot tell you.

## Both engines ship

`index.js` resolves reSIDfp from this directory and SIDLite from `./sidlite/`, matching
the tarball's layout. Which one loads is the user's choice in **Settings → SID Radio →
SID emulation**; the app defaults to **reSIDfp** (`index.js`'s own `DEFAULT_SID_ENGINE`
is `sidlite`, but the app always passes an engine explicitly). SIDLite renders roughly
an order of magnitude faster and is kept for hardware that cannot hold realtime with the
reference engine (`AUDIO-FIDELITY-TEST.md` §L1).

reSIDfp is asserted at build time in sidflow (`WasmReSIDfp` present, `WasmSIDLite`
absent) plus a functional smoke render, and is indistinguishable from a native build of
the same library: correlation > 0.99999 with an error floor around −80 dBFS. It is not
bit-exact — emscripten's libm differs from glibc's in the last ulp, which reaches
reSIDfp's table generation.

## Local edits to `index.js` (re-apply if it is ever re-vendored)

Only to work in this flat directory instead of the source's `dist/` layout:

1. `import … from "../dist/libsidplayfp.js"` → `"./libsidplayfp.js"`.
2. `new URL("../dist/", import.meta.url)` → `new URL("./", import.meta.url)` (so the
   `.wasm` resolves as a sibling of `index.js`).
3. Dropped the trailing `//# sourceMappingURL=` comments (`.map` files not shipped).

## Licence (spec §12.2, LE0 — PASS)

libsidplayfp is **GPL-2.0-or-later** (see the fetched `LICENSE`), compatible with this
app's **GPL-3.0-or-later** licence; the conveyed combined work is GPL-3.0-or-later.
`libresidfp` (an external library since v3.x split reSIDfp out) is likewise
**GPL-2.0-or-later**, and transitive components are v2-or-later/permissive; no
GPL-2.0-**only** component. Attributed in `THIRD_PARTY_NOTICES.md`. The `LICENSE` is
fetched and bundled with the binaries, so it travels with them.

**ROMs are never bundled.**

> **ROMs are a prerequisite, not an accuracy upgrade.** Measured in
> `AUDIO-FIDELITY-TEST.md` §6.2: without KERNAL/BASIC the engine initialises a tune and
> then never advances it — a flat drone (per-second RMS constant to four decimals),
> envelope correlation ~0.008. With ROMs it reaches 1.000 against native and 0.625
> against real hardware. This affects PSID as well as RSID. The app reads the ROMs from
> the connected Ultimate over DMA at the user's request, keeps them on the user's own
> phone, and never bundles, uploads, exports or diagnoses with them.
