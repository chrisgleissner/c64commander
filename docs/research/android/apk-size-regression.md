# Android APK/AAB Size Regression Investigation

Date: 2026-04-11
Status: In execution
Scope: Android release size regression introduced between `0.7.2` and `0.7.3`

## Summary

The Android size regression was caused by packaging the new upstream 7-Zip native payload for all four Android ABIs in release artifacts after `0.7.3` introduced HVSC 7z support.

The shipped `0.7.3` and `0.7.4` APK/AAB both included:

- `arm64-v8a`
- `armeabi-v7a`
- `x86`
- `x86_64`

That release-native payload alone accounted for `4,863,914` compressed bytes in both the APK and the AAB. The optimized current release reduces that native payload to the two physical-device ARM ABIs only while preserving broad real-device support:

- `arm64-v8a`
- `armeabi-v7a`

Debug and `minifiedDebug` still keep all four ABIs for emulator and development workflows.

## Measured Artifact Sizes

| Artifact                        |    APK bytes | APK delta vs 0.7.2 |    AAB bytes | AAB delta vs 0.7.2 |
| ------------------------------- | -----------: | -----------------: | -----------: | -----------------: |
| `0.7.2` published release       |  `5,924,008` |           baseline |  `6,706,223` |           baseline |
| `0.7.3` published release       | `10,791,126` |       `+4,867,118` | `11,580,702` |       `+4,874,479` |
| `0.7.4` published release       | `10,818,038` |       `+4,894,030` | `11,608,467` |       `+4,902,244` |
| current optimized local release |  `8,250,729` |       `+2,326,721` |  `9,041,015` |       `+2,334,792` |

Current optimized release versus shipped releases:

- APK vs `0.7.3`: `-2,540,397` bytes (`-23.54%`)
- APK vs `0.7.4`: `-2,567,309` bytes (`-23.73%`)
- AAB vs `0.7.3`: `-2,539,687` bytes (`-21.93%`)
- AAB vs `0.7.4`: `-2,567,452` bytes (`-22.12%`)

## Byte-Level Attribution

### Published `0.7.3` APK/AAB native payload

Compressed native total: `4,863,914` bytes

| File                                             | Uncompressed bytes | Compressed bytes |
| ------------------------------------------------ | -----------------: | ---------------: |
| `lib/arm64-v8a/lib7zz.so`                        |        `2,698,896` |      `1,174,402` |
| `lib/arm64-v8a/libdatastore_shared_counter.so`   |            `7,112` |          `2,630` |
| `lib/armeabi-v7a/lib7zz.so`                      |        `2,346,576` |      `1,134,475` |
| `lib/armeabi-v7a/libdatastore_shared_counter.so` |            `4,416` |          `2,033` |
| `lib/x86/lib7zz.so`                              |        `2,952,116` |      `1,328,393` |
| `lib/x86/libdatastore_shared_counter.so`         |            `5,148` |          `2,330` |
| `lib/x86_64/lib7zz.so`                           |        `2,735,352` |      `1,217,331` |
| `lib/x86_64/libdatastore_shared_counter.so`      |            `6,224` |          `2,320` |

The published `0.7.4` APK/AAB carried the same native payload sizes.

### Current optimized APK/AAB native payload

Compressed native total: `2,313,515` bytes

| File                                             | Uncompressed bytes | Compressed bytes |
| ------------------------------------------------ | -----------------: | ---------------: |
| `lib/arm64-v8a/lib7zz.so`                        |        `2,698,896` |      `1,174,385` |
| `lib/arm64-v8a/libdatastore_shared_counter.so`   |            `7,112` |          `2,630` |
| `lib/armeabi-v7a/lib7zz.so`                      |        `2,346,576` |      `1,134,467` |
| `lib/armeabi-v7a/libdatastore_shared_counter.so` |            `4,416` |          `2,033` |

### Removed payload

The fix removed the x86/x86_64 release-native payload:

- `lib/x86/lib7zz.so`
- `lib/x86/libdatastore_shared_counter.so`
- `lib/x86_64/lib7zz.so`
- `lib/x86_64/libdatastore_shared_counter.so`

Compressed reduction in the total packaged native payload:

- `4,863,914 - 2,313,515 = 2,550,399` bytes

This matches the observed total APK/AAB reduction to within normal ZIP recompression differences.

## Root Cause

`0.7.3` introduced upstream 7-Zip native binary generation for HVSC 7z extraction. The regression was not caused by debug-symbol leakage:

- extracted `lib7zz.so` binaries in both shipped `0.7.3` and current optimized builds are reported as `stripped`
- section inspection shows `.dynsym` only, with no `.debug_*` or `.symtab` sections in the inspected release binary

The actual regression came from release packaging scope:

1. A single generated JNI directory was attached to the main source set, so release artifacts consumed the same all-ABI output used for debug.
2. Release artifacts therefore bundled the upstream 7-Zip executable payload for `x86` and `x86_64` in addition to the two ARM device ABIs.
3. That unnecessary extra release-native payload explains the removable portion of the size spike.

## Fix Implemented

Implemented in `android/app/build.gradle`:

1. Split upstream 7-Zip output directories per variant instead of sharing one all-ABI directory across all build types.
2. Kept `debug` and `minifiedDebug` on all four ABIs for emulator and development coverage.
3. Restricted `release` to `armeabi-v7a` and `arm64-v8a` only.
4. Moved ABI filtering into build types so all release-native dependencies follow the same packaging policy.
5. Added a regression test in `tests/unit/scripts/androidUpstream7zipPackaging.test.ts` to lock the release-vs-debug ABI policy.

## Why Remaining Growth Is Unavoidable

Compared with `0.7.2`, the optimized current release is still larger:

- APK: `+2,326,721` bytes
- AAB: `+2,334,792` bytes

That residual increase is almost entirely the necessary ARM release payload for the upstream 7-Zip executable:

- current compressed ARM native payload: `2,313,515` bytes

Residual after subtracting the required ARM payload:

- APK remainder beyond required ARM payload: `13,206` bytes
- AAB remainder beyond required ARM payload: `21,277` bytes

So after removing the unnecessary x86/x86_64 release payload, nearly all remaining size above `0.7.2` is the unavoidable cost of shipping the required upstream 7-Zip implementation for:

- modern ARM64 Android devices
- older ARMv7 Android devices still intentionally supported

No decompression approach was replaced.

## Validation Completed So Far

- `npm run lint`
- `npm run build`
- `./android/gradlew -p android test --console=plain`
- Pixel 4 Maestro proof via `scripts/run-maestro.sh --mode tags --tags hvsc-perf-setup ...`
- Fresh-state Pixel 4 Maestro proof via direct `maestro test .maestro/perf-hvsc-baseline.yaml ...` after uninstall + reinstall + `pm clear`

Completed Pixel 4 proof from the successful warm-state setup run:

- `hvsc-download` control found and tapped
- `Status: Ready` reached after the HVSC setup action
- `HVSC ready` visible
- `From HVSC` visible in the add-items flow
- `Playlist` visible after returning to the playback surface

Artifacts:

- `test-results/maestro/apk-size-hvsc-proof/maestro-report.xml`
- `test-results/maestro/apk-size-hvsc-proof/2026-04-11_161439/commands-(perf-hvsc-baseline).json`
- `test-results/maestro/apk-size-hvsc-proof-fresh-perf/maestro-report.xml`
- `test-results/maestro/apk-size-hvsc-proof-fresh-perf/2026-04-11_165421/commands-(perf-hvsc-baseline).json`

Completed fresh-state Pixel 4 proof from a clean install and cleared app state:

- app was uninstalled, reinstalled from `android/app/build/outputs/apk/release/c64commander-0.7.4.apk`, and cleared with `pm clear`
- `hvsc-download` control found and tapped
- `Status: Ready` reached after `39.4s`
- `HVSC ready` visible
- the conditional manual `Run Ingest HVSC` step was not shown on this clean-state run
- in the same session, HVSC browsing opened successfully with `From HVSC`
- `Open DEMOS` became visible
- `Add to playlist` completed after HVSC selection, proving the indexed HVSC library was usable on-device immediately after setup
- Maestro reported `SUCCESS` in `224s`

The clean-state proof demonstrates that HVSC download, extraction, and index-ready consumption still work on the Pixel 4 with the optimized release build. Full coverage rerun status is tracked in `WORKLOG.md`.
