# C64U Contract Test Harness

This harness derives a machine-consumable contract test record for the C64U REST API and FTP service.
It supports SAFE runs, deterministic STRESS breakpoint runs, structured load-matrix runs, and deterministic replay from recorded traces. All outputs are written under test-results/.

## Requirements

- Node.js 24.x
- A reachable C64U device on the local network

## Build + Run

Build the harness (TypeScript -> JS):

```bash
npx tsc -p tests/contract/tsconfig.json
```

Run a SAFE session:

```bash
node tests/contract/dist/run.js --config tests/contract/config.sample.json
```

Run a SAFE session with full trace and replay artifacts enabled:

```bash
node tests/contract/dist/run.js --config tests/contract/config.trace.safe.json
```

Run the deterministic SID volume breakpoint profile:

```bash
node tests/contract/dist/run.js --config tests/contract/config.stress.breakpoint.sample.json
```

Run the structured matrix profiles:

```bash
node tests/contract/dist/run.js --config tests/contract/config.stress.matrix.quick.json
node tests/contract/dist/run.js --config tests/contract/config.stress.matrix.stress.json
node tests/contract/dist/run.js --config tests/contract/config.stress.matrix.soak.json
node tests/contract/dist/run.js --config tests/contract/config.stress.matrix.spike.json
```

Override the configured matrix type from the CLI:

```bash
node tests/contract/dist/run.js --config tests/contract/config.stress.matrix.quick.json --test-type soak
```

Replay a recorded manifest without contacting the device:

```bash
node tests/contract/dist/replay.js --manifest test-results/contract/runs/<run-id>/replay/manifest.json --config tests/contract/config.trace.safe.json --dry-run
```

Replay a recorded manifest against the device:

```bash
node tests/contract/dist/replay.js --manifest test-results/contract/runs/<run-id>/replay/manifest.json --config tests/contract/config.trace.safe.json
```

Compare AUTH ON vs AUTH OFF runs:

```bash
node tests/contract/dist/compare.js --left test-results/contract/runs/<run-a> --right test-results/contract/runs/<run-b>
```

## Output Layout

Outputs are written to:

```
test-results/
  contract/
    runs/
      <timestamp>-<mode>-<auth>/
        meta.json
        logs.jsonl
        endpoints.json
        latency-stats.json
        rest-cooldowns.json
        ftp-cooldowns.json
        concurrency.json
        conflicts.json
        trace.jsonl                  # only when trace.enabled=true
        trace.md                     # only when trace.enabled=true
        breakpoint-stages.json       # breakpoint profile only
        failure-summary.json         # breakpoint profile only
        request-trace-tail.json      # breakpoint profile only
        matrix-stages.json           # stressMatrix profiles only
        matrix-failure-summary.json  # stressMatrix profiles only
        DEVICE_UNRESPONSIVE          # only when the run aborts on health failure
        replay/                      # only when trace.enabled=true
          manifest.json
          device-replay.http
          device-replay.sh
    latest/
```

`meta.json` includes an `outcome` field:

- `completed`: the run or replay finished without a health-triggered abort.
- `device-unresponsive`: the harness aborted after the health monitors declared the device unreachable.

The main runner and replay runner both exit with code `2` when they write `DEVICE_UNRESPONSIVE`.

## SAFE vs STRESS

- SAFE is reversible and limits writes to safe config toggles and an FTP scratch directory.
- STRESS is opt-in and may be disruptive. It enforces hard runtime caps and abort conditions.
- `stressBreakpoint` and `stressMatrix` are mutually exclusive. Breakpoint runs preserve the legacy breakpoint artifacts; matrix runs write staged load results and stage-tagged traces.

## Forensic Recorder

Enable the recorder with:

```json
{
  "trace": {
    "enabled": true,
    "level": "full"
  }
}
```

Recorder behavior:

- REST request and response entries are emitted with `correlationId`, `clientId`, `launchedAtMs`, headers, and body previews.
- FTP command, response, and data entries are emitted with `ftpSessionId`, `clientId`, `commandVerb`, and byte counts.
- `X-Password` is redacted from replay outputs and replaced with `SET_PASSWORD_HERE` comments.
- `trace.jsonl` is append-only JSONL for machine analysis.
- `trace.md` groups request/response pairs for human review.
- `replay/manifest.json` is generated from the same captured sequence and feeds `replay.js`.

## Structured Load Driver

Configure the structured matrix with a `stressMatrix` block. The harness expands the cartesian product of:

- `operationIds`
- `concurrencyLevels`
- `rateRampMs`
- `ftpSessionMode`

Supported matrix types:

- `stress`: runs the full cartesian plan once.
- `soak`: runs a single steady-state stage.
- `spike`: inserts idle gaps between stage bursts.

Each generated stage records:

- `stageId`, `order`, `testType`, `operationId`
- concurrency and pacing
- status, started/completed counts, success/failure counts
- first failure details when a stage aborts

If REST or FTP health falls below the configured threshold, the harness stops scheduling additional work, writes `matrix-failure-summary.json`, records `DEVICE_UNRESPONSIVE`, and preserves the forensic artifacts.

## Media-Driven REST Scenarios (STRESS)

Some REST endpoints require real filesystem paths. Provide them via the optional `media` block in your config:

```json
{
  "media": {
    "diskImagePath": "/Usb0/disks/demo.d64",
    "diskDrive": "a",
    "diskType": "d64",
    "diskMode": "readonly",
    "sidFilePath": "/Usb0/music/demo.sid",
    "sidSongNr": 0,
    "prgFilePath": "/Usb0/prg/demo.prg",
    "prgAction": "run"
  }
}
```

If a path is omitted, the corresponding scenario is skipped.

If a path points at a directory, the harness will crawl that subtree over FTP and pick the first matching file
(`.d64`, `.d71`, `.d81`, `.dnp`, `.g64` for disks; `.sid` for SID; `.prg` for PRG).

Machine reset is guarded by `allowMachineReset` (defaults to false).

## Concurrency Stress

Increase `concurrency.restMaxInFlight` to probe high-load behavior. The harness records:

- REST concurrency observations (errors, drift, max latency).
- Per-operation latency percentiles, which feed cooldown suggestions.

## Breakpoint Stress

Enable the optional `stressBreakpoint` block in `STRESS` mode to skip the normal STRESS matrix and run a single
deterministic breakpoint profile. Breakpoint runs:

- ramp `rateRampMs` and `concurrencyRamp` in a fixed order
- mutate the configured SID volume targets via the shared REST request path
- append full `rest-trace` entries to `logs.jsonl`
- stop scheduling immediately when REST or health failures occur
- write `breakpoint-stages.json`, `failure-summary.json`, and `request-trace-tail.json`
- skip automatic reboot/recovery after a breakpoint-triggered failure so the device state is preserved for forensics

## Deterministic Replay

Replay uses `replay/manifest.json` to preserve:

- original request ordering
- per-`clientId` sequencing
- relative `launchedAtMs` offsets

Replay preflight checks both REST and FTP connectivity before scheduling requests. During an online replay:

- REST calls reuse the harness request path and record fresh trace output.
- FTP sessions are reused by `ftpSessionId` when present.
- `STOR` operations preserve the recorded byte count, but replayed upload bodies are synthetic buffers rather than the original captured payload bytes.

Replay limitations:

- it is deterministic in ordering and relative offsets, not in exact end-to-end latency reproduction
- it replays request intent, not raw TCP packet captures
- dry-run prints the planned schedule and performs no network I/O

## Notes

- REST auth uses the network password (`X-Password` header).
- FTP auth uses PASS with the same network password.
- If the network password is empty, AUTH OFF mode is supported by firmware.
- The harness reboots the device and waits for `/v1/info` to recover before exiting, except after breakpoint or device-unresponsive abort paths that intentionally preserve state for forensics.

See `tests/contract/instrumentation-validation.md` for the concrete validation runs and recorded evidence.
