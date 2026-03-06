# CI Telemetry

This directory contains low-overhead CI telemetry for Android emulator, iOS simulator, Docker, and Linux-host fuzz runs.

## Outputs

Each monitor writes:

- `metrics.csv`
- `events.log`
- `metadata.json`
- `monitor.log`

Summary generation writes:

- `ci-artifacts/telemetry/summary.json`
- `ci-artifacts/telemetry/summary.md`

Chart rendering writes:

- `ci-artifacts/telemetry/charts/*.svg`
- `ci-artifacts/telemetry/charts/*.png`
- `ci-artifacts/telemetry/charts/index.md`

## CSV schema

`timestamp,platform,device,process_name,pid,cpu_percent,rss_kb,threads,pss_kb,dalvik_pss_kb,native_pss_kb,total_pss_kb`

- `timestamp`: unix seconds (UTC)
- `cpu_percent`: process CPU percent (float, one decimal)
- `rss_kb`: resident memory in KB
- `threads`: thread count when available
- `pss_*`: Android-only PSS fields from per-PID `dumpsys meminfo`
- iOS keeps Android-only columns empty for stable schema

## Android monitor

Script: `ci/telemetry/android/monitor_android.sh`

- Detects main process `ANDROID_PACKAGE_NAME`
- Detects renderer process `ANDROID_PACKAGE_NAME:renderer` when present
- Samples every `TELEMETRY_INTERVAL_SEC` (default `1`)
- CPU uses `/proc/<pid>/stat` deltas over `/proc/stat` with CPU core scaling
- RSS and threads from `/proc/<pid>/status`
- PSS from `dumpsys meminfo <pid>` on a throttled interval (`TELEMETRY_ANDROID_PSS_INTERVAL_SEC`, default `3`) while emitting 1-second samples with cached PSS values to reduce monitor overhead
- Emits process lifecycle events (appeared/restarted/disappeared)

## iOS monitor

Script: `ci/telemetry/ios/monitor_ios.sh`

- Resolves simulator via `SIMULATOR_UDID` or booted simulator fallback
- Detects app PID using `BUNDLE_ID` against simulator `ps`, with `simctl launchctl list` fallback
- Falls back to `TELEMETRY_IOS_APP_PROCESS_NAME` (default `App`) when bundle-id matching is unavailable in `ps` output
- Samples per PID via host macOS `ps -p <pid> -o %cpu=,rss=,nlwp=` at 1 Hz
- Optionally attempts WebKit child capture only when process parent relation is explicit in simulator `ps`
- Optional slow metric path (`TELEMETRY_ENABLE_VMMAP=1`) reads `vmmap -summary` every 30s

## Linux monitor (fuzz)

Script: `ci/telemetry/linux/monitor_linux.sh`

- Matches process command line with `TELEMETRY_PROCESS_MATCH`
- Samples every `TELEMETRY_INTERVAL_SEC` (default `1`)
- Uses `/proc` for CPU, RSS, and thread count
- Emits process lifecycle events and end-of-run disappearance status

## Summarizer

Script: `ci/telemetry/summarize_metrics.py`

- Reads all `metrics.csv` files under `ci-artifacts/telemetry/**`
- Computes min/median/max for per-process and aggregate views
- Handles missing fields cleanly
- Writes machine-readable and markdown summaries

## Charts

Script: `ci/telemetry/render_charts.py`

- Renders deterministic SVG and PNG charts from telemetry `metrics.csv`
- Emits one chart per platform plus `charts/index.md`

## Capacitor interpretation notes

Capacitor app memory is not bounded by Java/Kotlin VM heap settings alone.

- TypeScript executes in WebView V8 and contributes mainly to native/off-heap usage.
- Android `vm.heapSize` does not cap WebView renderer memory.
- Rising Android `native_pss_kb` with flatter `dalvik_pss_kb` often indicates WebView/native growth.

## Correlating with Maestro

- Telemetry timestamps are unix UTC seconds.
- Compare those against Maestro logs and screenshots/videos to locate resource spikes before failure.

## CI artifact expectations

Telemetry artifacts are uploaded with `if: always()` so failed test runs still preserve:

- raw CSV
- events
- metadata
- summary

## Failure policy

- Monitor startup failure: fail the job.
- Empty telemetry CSV: fail the job.
- App PID disappearance during active flow (`flow-active.flag` present,
  `flow-complete.flag` absent): exit code 3 and fail at end-of-job (after
  artifact upload).
- App PID disappearance after flow completion (`flow-complete.flag` present):
  exit code 0, treated as expected teardown.

## Lifecycle signaling

The CI workflow signals flow lifecycle to the monitor via flag files in the
telemetry output directory:

- `flow-active.flag` — created before Maestro execution begins.
- `flow-complete.flag` — created after Maestro execution finishes (regardless
  of pass/fail). `flow-active.flag` is removed at the same time.

The monitor checks these flags at the moment a process disappearance is detected
to classify it as a crash (during active flow) or expected teardown (after flow
completion).
