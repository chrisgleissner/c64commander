# Proof-of-Work Schema

This document defines the **only** evidence a reviewer accepts as proof
that a soak run produced its claimed verdict. No prose verdict is
accepted without the artifacts below. This mirrors `../iteration2/proof-of-work.md`
and tightens it for the volume-and-playback focus.

## Per-run directory

A run lives in `runs/<runId>/` where `<runId>` is a UUIDv4. The
directory must contain:

```
runs/<runId>/
├── summary.json
├── preflight.json
├── device-info.json
├── logcat.txt
├── logcat.errors.ndjson
├── steps.ndjson
├── safety/
│   └── safety-mode-trail.ndjson
├── timings/
│   ├── volume-slider.csv
│   ├── volume-mute.csv
│   ├── transport.csv
│   └── background-advance.csv
├── oracles/
│   ├── slider-snapback.ndjson
│   ├── slider-stuck.ndjson
│   ├── mute-glitch.ndjson
│   ├── transport-events.ndjson
│   ├── background-advance.ndjson
│   └── errors.ndjson
├── screenshots/
│   ├── V1-play-after-drag.png
│   ├── V3-home-after-drag.png
│   ├── V4-after-toggle-burst.png
│   ├── P1-after-stop.png
│   ├── P3-after-next-burst.png
│   └── P4-after-screen-off-fire.png
└── screen.mp4
```

Files marked optional below may be omitted only with an explicit
"omitted because" note in `summary.json`. Everything else is mandatory.

## `summary.json`

```json
{
  "runId": "uuid-v4",
  "startedAtMs": 0,
  "finishedAtMs": 0,
  "appVersion": "0.7.9-rc1",
  "device": {
    "phone": "Pixel 4",
    "adbSerialPrefix": "9B0",
    "androidVersion": "13",
    "targetDevice": "u64",
    "targetProduct": "U64 Elite",
    "safetyMode": "AUTO",
    "effectivePreset": "BALANCED"
  },
  "scenarios": [
    {
      "id": "V1",
      "verdict": "PASS" | "BUG_REPRODUCED" | "INCONCLUSIVE",
      "evidenceFiles": [
        "oracles/slider-snapback.ndjson",
        "timings/volume-slider.csv",
        "screenshots/V1-play-after-drag.png"
      ],
      "snapbackEventCount": 0,
      "stuckThumbEventCount": null,
      "muteGlitchEventCount": null,
      "doubleAdvanceCount": null,
      "backgroundAdvanceOnTimeRatio": null,
      "userVisibleErrorCount": 0
    }
  ],
  "responsivenessBudget": {
    "volumePreviewP50Ms": 0,
    "volumePreviewP95Ms": 0,
    "volumeCommitP50Ms": 0,
    "volumeCommitP95Ms": 0,
    "muteTapP50Ms": 0,
    "muteTapP95Ms": 0,
    "transportTapP50Ms": 0,
    "transportTapP95Ms": 0,
    "backgroundAdvanceSkewP95Ms": null,
    "backgroundAdvanceSkewMaxMs": null
  },
  "userVisibleErrorCount": 0,
  "crashCount": 0,
  "anrCount": 0,
  "u64InfoReachableAtEndMs": 0,
  "overallVerdict": "PASS" | "FAIL" | "INCONCLUSIVE",
  "notes": ""
}
```

Rules:

- `overallVerdict: "PASS"` requires every scenario verdict to be
  `PASS` and every relevant budget value to be at or under the
  budget in `plan.md`.
- A scenario marked `BUG_REPRODUCED` flips `overallVerdict` to
  `FAIL` for any baseline run that intended to confirm the fix.
  For a Phase 2 baseline run, `BUG_REPRODUCED` is the expected
  state.
- `INCONCLUSIVE` is allowed only when a real environmental
  constraint (`u64` unreachable, Pixel 4 disconnected over adb,
  background-execution permission denied) prevented the scenario
  from running. The `notes` field must explain.

## `preflight.json`

```json
{
  "tsMs": 0,
  "pixel4AdbConnected": true,
  "pixel4Serial": "9B0xxxxxxx",
  "u64InfoReachable": true,
  "u64InfoReachableMs": 123,
  "appInstalled": true,
  "appVersion": "0.7.9-rc1",
  "storedSafetyMode": "AUTO",
  "batteryPercent": 78,
  "screenWakefulnessAtStart": "Awake"
}
```

`u64InfoReachable: false` immediately demotes the entire run to
`INCONCLUSIVE`. Do not proceed.

## `oracles/slider-snapback.ndjson`

One row per detected snap-back event. Schema (all required):

```json
{
  "tsMs": 0,
  "scenario": "V1" | "V3",
  "committedIndex": 0,
  "renderedIndexAfterMs500": 0,
  "renderedIndexAfterMs1500": 0,
  "deltaIndex": 0,
  "userGesturePresentDuringWindow": false,
  "lastKnownDeviceIndex": 0,
  "pendingVolumeWriteIndex": null,
  "screenshotPath": "screenshots/V1-snapback-1.png"
}
```

## `oracles/slider-stuck.ndjson`

One row per stuck-thumb event. Schema:

```json
{
  "tsMs": 0,
  "scenario": "V2",
  "stallStartMs": 0,
  "stallEndMs": 0,
  "stallDurationMs": 0,
  "pointerXAtStart": 0,
  "pointerXAtEnd": 0,
  "thumbXAtStart": 0,
  "thumbXAtEnd": 0,
  "framesDropped": 0
}
```

`stallDurationMs >= 100` is the threshold for a row.

## `oracles/mute-glitch.ndjson`

One row per mute/unmute glitch. Schema:

```json
{
  "tsMs": 0,
  "scenario": "V4",
  "tapIndex": 0,
  "expectedDeviceMuted": true,
  "uiMutedFlag": true,
  "deviceMutedFlag": false,
  "convergenceDelayMs": 0
}
```

`convergenceDelayMs > 1500` is a fail row. So is any row where the
final state never converges.

## `oracles/transport-events.ndjson`

One row per control tap and per auto-advance fire:

```json
{
  "tsMs": 0,
  "scenario": "P1" | "P2" | "P3" | "P4" | "P5",
  "kind": "play" | "pause" | "resume" | "stop" | "next" | "previous" | "auto-advance",
  "source": "user" | "auto",
  "trackInstanceIdBefore": 0,
  "trackInstanceIdAfter": 0,
  "expectedDelta": 1,
  "actualDelta": 1,
  "tapToFeedbackMs": 0,
  "result": "ok" | "double-fire" | "stale-instance" | "error"
}
```

## `oracles/background-advance.ndjson`

One row per scheduled auto-advance:

```json
{
  "tsMs": 0,
  "scenario": "P4" | "P5",
  "scheduledTrackInstanceId": 0,
  "dueAtMs": 0,
  "firedAtMs": null,
  "skewMs": null,
  "screenWakefulnessAtDueAt": "Asleep" | "Awake",
  "backgroundExecutionServiceRunning": true,
  "logcatRunnableFireMs": null,
  "result": "fired" | "late" | "missed"
}
```

A row with `result: "missed"` fails the run.

## `oracles/errors.ndjson`

One row per user-visible error observed during the run:

```json
{
  "tsMs": 0,
  "scenario": "V1" | ... | "P5",
  "source": "toast" | "diagnostics-tab" | "logcat-error" | "crash" | "anr",
  "level": "error" | "warn",
  "operation": "PLAYBACK_NEXT" | "VOLUME_UPDATE" | ...,
  "message": "..."
}
```

Any row in this file with `level: "error"` immediately fails the run.

## `timings/*.csv`

Each timings CSV has a header row and one row per measured event.

`volume-slider.csv`:

```
tsMs,scenario,phase,sliderIndex,latencyMs
1747695600000,V1,preview-send,12,87
1747695600300,V1,commit-send,12,210
1747695600450,V1,device-echo,12,52
```

`volume-mute.csv`:

```
tsMs,scenario,kind,convergedMs
1747695600000,V4,mute,310
```

`transport.csv`:

```
tsMs,scenario,kind,tapToFeedbackMs,deviceEchoMs
1747695600000,P1,play,142,322
```

`background-advance.csv`:

```
tsMs,scenario,dueAtMs,firedAtMs,skewMs,result
1747695600000,P4,1747695610000,1747695610842,842,fired
```

## Screen recording

`screen.mp4` is recorded for the duration of the run using `adb
shell screenrecord` (rotating files if it exceeds the 3-minute
single-file limit) and stitched into one file before close.

V2 (stuck-thumb) requires the recording to be at 60 fps, captured
with `--bit-rate 8000000 --size 1080x2280 --time-limit 180`. The
agent rotates files and concatenates them.

## Logcat

`logcat.txt` covers the entire run, filtered by `--pid $(adb shell
pidof uk.gleissner.c64commander)`.

`logcat.errors.ndjson` is the subset where the logcat priority is
`E` or where the tag is `BackgroundExecutionService`,
`BackgroundExecutionPlugin`, `AppLogger` and the message contains
`error`, `failed`, or `exception` (case-insensitive).

## Reviewer rejection conditions

A reviewer rejects the run if:

- `summary.json` is missing or fails JSON schema validation;
- any required oracle file is missing for a scenario that didn't
  short-circuit with `INCONCLUSIVE`;
- `screen.mp4` is missing or shorter than the wall-clock run
  duration minus 10 seconds;
- `logcat.txt` has no rows from `uk.gleissner.c64commander`;
- the `responsivenessBudget` field claims `PASS` but the
  corresponding CSV's percentiles exceed the budget when recomputed
  independently;
- `oracles/errors.ndjson` has an `error`-level row but the
  `userVisibleErrorCount` claims 0.
