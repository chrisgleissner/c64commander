# Worklog - Playback and Volume Control Iteration

This file is **append-only**. Each entry is dated and signed by the
agent or human who wrote it. New entries go at the bottom; do not
edit prior entries.

## Format

Each entry is one of:

- **Plan/spec change**: short note describing the change.
- **Code change**: commit SHA + one-line description, mapped to a
  hypothesis from `root-cause-hypotheses.md`.
- **Soak run**: `runId`, verdict, scenario verdicts, link to
  `summary.json`.
- **Deploy validation**: APK SHA, Pixel 4 install result,
  smoke-soak outcome.

## Entries

### 2026-05-19 - Iteration kickoff

Created the iteration directory at
`docs/plans/performance/playback-and-volume-control/` with the
following documents:

- `plan.md` - scope, phases, gates, exit criteria.
- `README.md` - reviewer / agent orientation.
- `root-cause-hypotheses.md` - six falsifiable hypotheses H1-H6 for
  the residual volume + playback bugs that survived Iteration 2.
- `soak-scenarios.md` - scenarios V1-V4 (volume) and P1-P5
  (playback).
- `regression-tests.md` - per-hypothesis regression-test specs.
- `proof-of-work.md` - required artifact schema per run.
- `agent-prompt.md` - self-contained prompt for the soak agent.
- `handover-prompt.md` - self-contained prompt for an agent picking
  up mid-flight.
- `worklog.md` - this file.

No source code changed in this commit. Iteration 2 status:
`fix/performance-iteration-2` branch, AUTO safety mode landed,
soak gates met for the `u64` legs. This iteration narrows scope
to volume + playback on a real Pixel 4 against `u64`.

Next step: run the Phase 2 baseline soak per `agent-prompt.md`.

### 2026-05-20 - Phase 2 baseline soak attempt (halted at preflight)

2026-05-20T08:17:10Z runId=e6f7ee40-d6df-4362-83f1-9e9fd2b5c9a2 verdict=INCONCLUSIVE
scenarios=V1:INCONCLUSIVE,V2:INCONCLUSIVE,V3:INCONCLUSIVE,V4:INCONCLUSIVE,P1:INCONCLUSIVE,P2:INCONCLUSIVE,P3:INCONCLUSIVE,P4:INCONCLUSIVE,P5:INCONCLUSIVE
notes="Halted at preflight on two structural blockers: (1) Pixel 4 playlist empty + HVSC not ingested, so V1/V2/V4/P1-P5 cannot satisfy entry conditions; (2) proof-of-work oracle schemas require source-level trace markers (volume-preview-send / volume-commit-send / volume-device-echo / playback-control) that do not exist in src/hooks/useDeviceBoundSlider.ts or src/pages/playFiles/hooks/useVolumeOverride.ts. Captures present: logcat.txt (376 lines), screen.mp4 (4:13), 4 u64 reachability samples (all 200 / <=20 ms), preflight.json, device-info.json, baseline-state screenshots. Lab readiness verified: adb serial 9B081FFAZ001WX, app 0.7.9-rc1 / 1986, U64 Elite 192.168.1.13, AUTO safety mode resolves to Balanced (verified), Pixel 4 battery 65% on USB. See runs/e6f7ee40-d6df-4362-83f1-9e9fd2b5c9a2/summary.json for full remediation guidance."

2026-05-20T10:11:45Z runId=083dc7bb-281a-4f39-b026-fa244fa4c7cb verdict=INCONCLUSIVE
scenarios=V1:INCONCLUSIVE,V2:INCONCLUSIVE,V3:INCONCLUSIVE,V4:INCONCLUSIVE,P1:INCONCLUSIVE,P2:INCONCLUSIVE,P3:INCONCLUSIVE,P4:INCONCLUSIVE,P5:INCONCLUSIVE
notes="Stopped before any droidmind/app-driving action because docs/plans/performance/iteration2/runs/HARDWARE_LOCK.json is stale but still present. Per ../iteration2/parallelization.md stale locks require human inspection and manual deletion before the next hardware run. Read-only preflight evidence captured: adb serial 9B081FFAZ001WX, app 0.7.9-rc1 / 1986, Pixel 4 battery 64% on USB, U64 /v1/info reachable from the phone via 192.168.1.13 in 87 ms, but short hostname u64 still does not resolve on-device. Settings safety-mode UI verification was not attempted because the stale lock blocked app interaction. See runs/083dc7bb-281a-4f39-b026-fa244fa4c7cb/summary.json."
2026-05-20T10:57:43Z runId=b1c2270c-41c7-468e-ae5b-36167df55707 verdict=INCONCLUSIVE scenarios=V1:INCONCLUSIVE,V2:INCONCLUSIVE,V3:INCONCLUSIVE,V4:INCONCLUSIVE,P1:INCONCLUSIVE,P2:INCONCLUSIVE,P3:INCONCLUSIVE,P4:INCONCLUSIVE,P5:INCONCLUSIVE notes="Preflight, playback, and passive auto-advance evidence completed on Pixel 4 9B081FFAZ001WX against u64 at 192.168.1.13, but Phase 2 stopped after V1 control calibration because Android input injection could not actuate the Play-page playback-volume slider or produce a trustworthy mute-state transition. Two post-drag screenshots and the on-device element tree kept the readout at 0 dB, so the remaining scenarios were demoted rather than fabricated. summary=docs/plans/performance/playback-and-volume-control/runs/b1c2270c-41c7-468e-ae5b-36167df55707/summary.json"

### 2026-05-20 - Deploy validation after Play volume-control fix

2026-05-20T21:31:00Z apk=android/app/build/outputs/apk/debug/c64commander-0.7.9-rc1-debug.apk install=PASS device=Pixel4:9B081FFAZ001WX outcome="Play-page control path proven on-device against u64 (192.168.1.13) after fixing SID-volume enablement fallback and adding the Android native-range overlay. Raw touch injection on the WebView tab bar remained unreliable, so validation switched to the debug WebView DevTools DOM path. Verified route navigation to /play, mute POST to /v1/configs with Audio Mixer -> Vol UltiSid 1/2 = -42 dB, unmute POST restoring both channels to 0 dB, single-step slider POST to -1 dB, and Play transport transition to active playback with elapsed time advancing. After each control burst, both u64 and c64u remained reachable at /v1/info (HTTP 200)."
2026-05-21T08:52:23.520Z runId=e355344e-b0b8-4a85-9d13-62c9ecc797a2 verdict=FAIL scenarios=V1:PASS,V2:BUG_REPRODUCED,V3:PASS,V4:BUG_REPRODUCED,P1:PASS,P2:PASS,P3:FAIL,P4:FAIL,P5:FAIL notes="summary=/home/chris/dev/c64/c64commander/docs/plans/performance/playback-and-volume-control/runs/e355344e-b0b8-4a85-9d13-62c9ecc797a2/summary.json; Executed via WebView DevTools + trace bridge with controlled C64U picker interactions; no app cold restart during soak run."
2026-05-21T11:43:00.154Z runId=859cbfb1-d530-4361-90f2-fa4fd446a3cc verdict=FAIL scenarios=V1:PASS,V2:PASS,V3:PASS,V4:BUG_REPRODUCED,P1:PASS,P2:PASS,P3:PASS,P4:FAIL,P5:FAIL notes="summary=/home/chris/dev/c64/c64commander/docs/plans/performance/playback-and-volume-control/runs/859cbfb1-d530-4361-90f2-fa4fd446a3cc/summary.json; Executed via WebView DevTools + trace bridge with controlled C64U picker interactions; no app cold restart during soak run."
2026-05-21T12:25:39.979Z runId=fc96dc04-410f-4db5-8491-b6f2f8072761 verdict=FAIL scenarios=V1:PASS,V2:PASS,V3:PASS,V4:PASS,P1:PASS,P2:PASS,P3:PASS,P4:FAIL,P5:FAIL notes="summary=/home/chris/dev/c64/c64commander/docs/plans/performance/playback-and-volume-control/runs/fc96dc04-410f-4db5-8491-b6f2f8072761/summary.json; Executed via WebView DevTools + trace bridge with controlled C64U picker interactions; no app cold restart during soak run."
2026-05-21T13:08:49.948Z runId=1860d408-ddb6-4bd0-8e4f-0e1d3a8818f5 verdict=FAIL scenarios=V1:PASS,V2:PASS,V3:PASS,V4:BUG_REPRODUCED,P1:PASS,P2:PASS,P3:PASS,P4:FAIL,P5:FAIL notes="summary=/home/chris/dev/c64/c64commander/docs/plans/performance/playback-and-volume-control/runs/1860d408-ddb6-4bd0-8e4f-0e1d3a8818f5/summary.json; Executed via WebView DevTools + trace bridge with controlled C64U picker interactions; no app cold restart during soak run."
2026-05-21T14:04:15.154Z runId=bbc417e4-3823-4821-9081-487a30b75276 verdict=FAIL scenarios=V1:PASS,V2:PASS,V3:PASS,V4:PASS,P1:PASS,P2:PASS,P3:FAIL,P4:FAIL,P5:FAIL notes="summary=/home/chris/dev/c64/c64commander/docs/plans/performance/playback-and-volume-control/runs/bbc417e4-3823-4821-9081-487a30b75276/summary.json; Executed via WebView DevTools + trace bridge with controlled C64U picker interactions; no app cold restart during soak run."
2026-05-21T17:57:37.773Z runId=5dc9ded8-2f36-4dc7-8a67-92dba88fa49d verdict=FAIL scenarios=V1:BUG_REPRODUCED,V2:PASS,V3:BUG_REPRODUCED,V4:BUG_REPRODUCED,P1:PASS,P2:PASS,P3:PASS,P4:FAIL,P5:FAIL notes="summary=/home/chris/dev/c64/c64commander/docs/plans/performance/playback-and-volume-control/runs/5dc9ded8-2f36-4dc7-8a67-92dba88fa49d/summary.json; Executed via WebView DevTools + trace bridge with controlled C64U picker interactions; no app cold restart during soak run."
2026-05-21T18:53:47.910Z runId=1691c61b-d982-4e20-b8d4-c5c594ccca56 verdict=FAIL scenarios=V1:BUG_REPRODUCED,V2:PASS,V3:PASS,V4:PASS,P1:PASS,P2:PASS,P3:PASS,P4:FAIL,P5:FAIL notes="summary=/home/chris/dev/c64/c64commander/docs/plans/performance/playback-and-volume-control/runs/1691c61b-d982-4e20-b8d4-c5c594ccca56/summary.json; Executed via WebView DevTools + trace bridge with controlled C64U picker interactions; no app cold restart during soak run."
2026-05-21T20:18:26.082Z runId=41f3a815-e0ad-42fc-89d7-8cc5dc9fa4ed verdict=FAIL scenarios=V1:BUG_REPRODUCED,V2:PASS,V3:PASS,V4:PASS,P1:PASS,P2:PASS,P3:PASS,P4:FAIL,P5:FAIL notes="summary=/home/chris/dev/c64/c64commander/docs/plans/performance/playback-and-volume-control/runs/41f3a815-e0ad-42fc-89d7-8cc5dc9fa4ed/summary.json; Executed via WebView DevTools + trace bridge with controlled C64U picker interactions; no app cold restart during soak run."
2026-05-21T22:35:40.386Z runId=690945ef-0beb-473f-a2ef-598f25183635 verdict=FAIL scenarios=V1:BUG_REPRODUCED,V2:PASS,V3:PASS,V4:PASS,P1:PASS,P2:PASS,P3:PASS,P4:FAIL,P5:FAIL notes="summary=/home/chris/dev/c64/c64commander/docs/plans/performance/playback-and-volume-control/runs/690945ef-0beb-473f-a2ef-598f25183635/summary.json; Executed via WebView DevTools + trace bridge with controlled C64U picker interactions; no app cold restart during soak run."
2026-05-21T23:15:49.893Z runId=a4d5f20e-af03-4d43-8850-4d751690cb33 verdict=FAIL scenarios=V1:PASS,V2:PASS,V3:PASS,V4:PASS,P1:PASS,P2:PASS,P3:PASS,P4:PASS,P5:FAIL notes="summary=/home/chris/dev/c64/c64commander/docs/plans/performance/playback-and-volume-control/runs/a4d5f20e-af03-4d43-8850-4d751690cb33/summary.json; Executed via WebView DevTools + trace bridge with controlled C64U picker interactions; no app cold restart during soak run."
2026-05-21T23:55:29.078Z runId=46446130-b7ce-4229-b2bf-3ec73687537d verdict=FAIL scenarios=V1:PASS,V2:PASS,V3:PASS,V4:PASS,P1:PASS,P2:PASS,P3:PASS,P4:PASS,P5:FAIL notes="summary=/home/chris/dev/c64/c64commander/docs/plans/performance/playback-and-volume-control/runs/46446130-b7ce-4229-b2bf-3ec73687537d/summary.json; Executed via WebView DevTools + trace bridge with controlled C64U picker interactions; no app cold restart during soak run."
