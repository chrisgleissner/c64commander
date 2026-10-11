# Unified SID renderers: implementation plan

## Summary

C64 Commander renders SID tunes on the device with libsidplayfp-wasm (reSIDfp and SIDLite) in a
Web Worker. `LocalSidEngine` owns all orchestration (open, chunked render, seek, pre-render,
lead-in warming, crossfade, stall recovery) and talks to the renderer only through the worker
message protocol in `localSidWorkerProtocol.ts`. On Android the PCM then goes worker → main
thread → Int16-to-Float32 planar conversion (scheduler) → Float32-to-Int16 interleave with gain
(`localSidNativeSink`) → base64 → Capacitor JSON bridge → Kotlin decode → `AudioPipeline` ring.

This change adds libSidplayEZ as a third renderer that runs natively on Android, and moves every
PCM operation on Android out of JavaScript:

- One renderer contract (`SidRendererCore`) with three implementations: WASM reSIDfp, WASM
  SIDLite and native libSidplayEZ. The worker protocol dispatcher is shared, so message ordering,
  generation skipping and error mapping exist once.
- `LocalSidEngine` stays the single orchestrator for all three. It sees PCM as an opaque
  `PcmPayload` (a JS `Int16Array`, or a reference to a native buffer).
- On Android all three renderers feed one native component, `LocalAudioFeed` (Kotlin), which
  takes over what `localSidNativeSink` did in JS: ordered segment queue, backpressure into
  `AudioPipeline`, crossfade fade-in, crossfade tail recovery and mixing, silence detection,
  playhead reporting. The JS sink becomes a thin controller.
- libSidplayEZ renders on a native thread per renderer instance into native PCM buffers held in
  `PcmStore`. Its PCM never enters JavaScript.
- WASM PCM reaches `LocalAudioFeed` over a binary `WebMessage` port (ArrayBuffer, no base64) when
  the WebView supports it, and over the Capacitor bridge (base64) otherwise. Segments carry a
  per-session sequence number, so data and control can travel on different channels without
  reordering.
- Web and iOS keep the Web Audio sink and the WASM worker unchanged.

## Device constraint for this work

The Pixel 4, c64u, u64 and u2 are in use by another agent. All development and testing runs
locally: Vitest, Android JVM tests, host-built native tests, and an Android emulator on a port
other than 5554. Hardware runs happen only at the end, after agreeing device use with the other
agent.

## Stages

1. Baseline: host benchmark of WASM reSIDfp / SIDLite render cost (Node), emulator measurement of
   the existing JS transport cost per second of audio.
2. Native: pinned, checksum-verified libSidplayEZ build for arm64-v8a, armeabi-v7a, x86, x86_64
   (16 KB pages); JNI wrapper on `libsidplayfp::Player` (not the path-dependent EZ facade); host
   build for JVM and C++ tests (lifecycle, concurrency, bounds, cancellation, ASan/TSan).
3. Native feed: `PcmStore`, `LocalAudioFeed`, `SidplayEzRenderer`, `SidAudioPlugin`, WebMessage
   binary port; JVM tests ported from the JS sink tests.
4. TS: renderer contract + factory + availability, shared protocol dispatcher, WASM core, EZ
   core, `PcmPayload` through engine / scheduler / cache, thin native sink, per-engine render
   throughput.
5. App: Settings engine option (Android only), persisted-unavailable fallback, docs.
6. Verification: unit, contract, JVM, native, Playwright, emulator runtime per ABI available,
   benchmarks before/after, HIL at the end.

## Added requirements

- **Cross-engine equivalence.** Render the same tunes through reSIDfp (WASM), SIDLite (WASM) and
  libSidplayEZ (native) and compare pitch per note, note timing, start offset, duration, level,
  spectral balance, channel layout, subsong and PAL/NTSC behaviour. Automated, with tolerances
  derived from measurement, and run in CI (`npm run test:sid-engines`).
- **Engine test suite for libSidplayEZ.** Upstream has no tests. A C++ suite run by the Android
  build (host, plain + ASan/UBSan + TSan) covers the tune loaders, song selection, clock and model
  detection, multi-SID setup, the 6510 (result bytes read back through SID registers), CIA/VIC
  play-call rates, oscillator pitch, envelope, filter routing, mixer placement, jam detection,
  determinism, sample-rate handling and save/restore.
- **Licence compliance for libSidplayEZ**, consistent with how libsidplayfp-wasm is credited:
  - `THIRD_PARTY_NOTICES.md` (generated, shown in-app on the Open source licenses page) gets a
    native-components entry: pinned revision, source URL, SHA-256, GPL-2.0-or-later, the
    copyright holders and contributors from upstream `AUTHORS`/`README.md`, the Aladdin
    Enterprises MD5 notice, VICE-derived code, and the statically linked LLVM libc++.
  - A statement of what this app changes: no upstream file is modified; `src/EZ/*.cpp` (the
    ultraSID application layer) is not compiled; the app's own JNI wrapper (GPL-3.0-or-later)
    sets the fallback chip, the neutral 6581 profile and the S16 conversion.
  - The Android build packages upstream `COPYING`, `AUTHORS`, `README.md`, a generated
    `NOTICE.md` and the exact pinned source archive (190 KB) next to the library, so the
    corresponding source travels with the binary.
  - The revision in the notices is read from `android/app/build.gradle`, and a unit test fails if
    the two disagree.
