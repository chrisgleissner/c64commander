# C64U Contract Test Harness

This harness derives a machine-consumable contract test record for the C64U REST API and FTP service.
It is designed for SAFE and STRESS runs and writes reproducible artifacts under test-results/.

## Requirements

- Node.js 18+
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
        logs.ndjson
        endpoints.json
        latency-stats.json
        rest-cooldowns.json
        ftp-cooldowns.json
        concurrency.json
        conflicts.json
    latest/
```

## SAFE vs STRESS

- SAFE is reversible and limits writes to safe config toggles and an FTP scratch directory.
- STRESS is opt-in and may be disruptive. It enforces hard runtime caps and abort conditions.

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

## Notes

- REST auth uses the network password (`X-Password` header).
- FTP auth uses PASS with the same network password.
- If the network password is empty, AUTH OFF mode is supported by firmware.
- The harness always reboots the device and waits for `/v1/info` to recover before exiting.
