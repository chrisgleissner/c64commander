# Playback Volume Latency Harness

This harness measures playback-volume and mute latency against a real C64 Ultimate or Ultimate 64 by combining:

- the existing `scripts/manual-play-sid.sh` upload-and-play flow
- real `Audio Mixer` REST writes for the same volume controls the Play page uses
- `c64scope` UDP audio capture and RMS envelope analysis to detect the first observed audio effect

The harness prefers `u64` first, then falls back to `c64u` if `u64` is unavailable.

## Run

From the repository root:

```bash
npm run scope:hil:playback-volume-latency
```

Optional arguments are forwarded after `--`:

```bash
npm run scope:hil:playback-volume-latency -- --host u64 --song tests/fixtures/local-source-assets/demo.sid
```

Useful options:

- `--host <u64|c64u|ip-or-hostname>`
- `--song <path-to-sid>`
- `--warmup-ms <milliseconds>`
- `--settle-ms <milliseconds>`
- `--burst-interval-ms <milliseconds>`
- `--artifact-dir <path>`

## Output

Artifacts are written under `c64scope/artifacts/playback-volume-latency/<timestamp-host>/`.

The harness writes:

- `playback-volume-latency-summary.json`
- `audio-stream-analysis.json`
- `audio-stream-packets.bin`

Per change, the summary includes:

- requested value
- request timestamp
- REST dispatch timestamp
- REST completion timestamp
- first observed audio-effect timestamp
- direct device-confirmation timestamp and confirmed value when audio detection is not reliable for a non-silent level change
- total latency
- stale-write indicator
- final-target indicator

The summary also reports aggregate `min`, `median`, `p90`, `p95`, `max`, `failures`, `staleWrites`, and `cancellations`.

## Scope

This harness measures device-side playback response and request-to-audio-effect latency.

Mute and full-silence transitions are measured from the UDP audio stream directly. When a non-silent volume step does not produce a clean enough RMS transition in the captured stream, the harness falls back to immediate device read-back confirmation for that step and records that fallback explicitly in the artifact.

Page-local behaviors such as latest-intent wins, stale-response suppression, and navigation invalidation remain covered by the Play page unit tests because those need app-local state and unmount semantics rather than direct device timing.
